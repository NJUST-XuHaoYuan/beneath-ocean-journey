#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2 uResolution;
uniform float uTime;
uniform float uProgress;
uniform vec2 uMouse;
uniform float uQuality;
uniform float uDiveVelocity;
uniform float uSplashAge;
uniform float uImpact;

#define PI 3.14159265359

float hash21(vec2 p) {
    p = mod(p,vec2(91.0,73.0));
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}
float noise21(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i), b = hash21(i + vec2(1.0,0.0));
    float c = hash21(i + vec2(0.0,1.0)), d = hash21(i + vec2(1.0,1.0));
    return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
}
float fbm(vec2 p) {
    float sum = 0.0, a = 0.54;
    for (int i = 0; i < 4; i++) {
        sum += noise21(p) * a;
        p = mat2(0.80,-0.60,0.60,0.80) * p * 2.03 + 6.4;
        a *= 0.48;
    }
    return sum;
}

// Ocean v3 surface module. Requires noise21/hash21/uTime/uQuality/uResolution.
// Geometry is bounded within [-0.52,0.65] metres. Normal footprint is metres/pixel.

float seaV3Profile(float x) {
    float s = 0.5+0.5*sin(x);
    return 2.0*s*s-0.75;
}

float seaHeight(vec2 p) {
    vec2 drift = vec2(uTime*0.025,-uTime*0.018);
    vec2 warp = vec2(noise21(p*0.24+drift),noise21(p*0.19-drift+15.73))-0.5;
    vec2 q = p+warp*1.45;
    float height = -0.067;
    float amplitude = 0.245;
    float frequency = 0.72;
    vec2 direction = normalize(vec2(0.86,0.51));
    for (int i=0;i<8;i++) {
        if (i==6 && uQuality<0.4) break;
        float fi=float(i);
        float phase = dot(q,direction)*frequency-uTime*sqrt(frequency)*1.24+fi*2.381;
        phase += sin(dot(p,vec2(-direction.y,direction.x))*0.17+fi)*0.29;
        height += seaV3Profile(phase)*amplitude;
        // Changing directions, speeds and compression break uniform wave rows.
        q += direction*cos(phase)*amplitude*0.43;
        direction = mat2(-0.438,0.899,-0.899,-0.438)*direction;
        frequency *= 1.35;
        amplitude *= 0.56;
    }
    return height;
}

vec2 seaV3NoiseSlope(vec2 p) {
    vec2 cell=floor(p), f=fract(p);
    vec2 u=f*f*(3.0-2.0*f), du=6.0*f*(1.0-f);
    float a=hash21(cell), b=hash21(cell+vec2(1.0,0.0));
    float c=hash21(cell+vec2(0.0,1.0)), d=hash21(cell+vec2(1.0,1.0));
    float k=a-b-c+d;
    return vec2(b-a+k*u.y,c-a+k*u.x)*du;
}

vec3 seaNormal(vec2 p,float footprint) {
    float e=max(0.006,min(0.065,footprint*0.6));
    vec2 slope=vec2(seaHeight(p+vec2(e,0.0))-seaHeight(p-vec2(e,0.0)),
                    seaHeight(p+vec2(0.0,e))-seaHeight(p-vec2(0.0,e)))/(2.0*e);
    vec2 warp=vec2(noise21(p*0.77+uTime*0.025),noise21(p*0.63-uTime*0.02+7.2));
    float frequency=11.0;
    float amplitude=0.085;
    for(int i=0;i<4;i++) {
        if(i==3 && uQuality<0.4) break;
        float a=float(i)*1.217;
        float c=cos(a),s=sin(a);
        vec2 q=mat2(c,s,-s,c)*p*frequency+warp*3.2+vec2(uTime*0.43,-uTime*0.36);
        float filter=1.0-smoothstep(0.32,0.95,frequency*footprint);
        vec2 ripples=vec2(sin(q.x+sin(q.y*.43)*.8),cos(q.y*.71+sin(q.x*.31))*.48);
        slope+=mat2(c,-s,s,c)*ripples*amplitude*filter;
        frequency*=2.09;
        amplitude*=0.60;
    }
    return normalize(vec3(-slope.x,1.0,-slope.y));
}

float traceSea(vec3 ro,vec3 rd) {
    const float bottom=-0.54;
    const float top=0.66;
    const float maxDistance=120.0;
    float nearT=0.012;
    float farT=maxDistance;
    // Intersection of the ray with the whole water-height interval. This is
    // symmetric for upward/downward rays and cameras on either side of water.
    if(abs(rd.y)>0.00015) {
        float a=(bottom-ro.y)/rd.y;
        float b=(top-ro.y)/rd.y;
        nearT=max(nearT,min(a,b));
        farT=min(farT,max(a,b));
        if(farT<=nearT) return -1.0;
    } else if(ro.y<bottom || ro.y>top) {
        return -1.0;
    }
    float t=nearT;
    vec3 p=ro+rd*t;
    float value=p.y-seaHeight(p.xz);
    float baseStep=clamp((farT-nearT)/84.0,0.028,0.30);
    float growth=1.0;
    for(int i=0;i<24;i++) {
        // Near field starts with short steps; growing intervals spend remaining
        // samples on the horizon. Scan is always front-to-back, on either side.
        if(value==0.0) return t;
        float fieldStep=abs(value)/(1.85+abs(rd.y));
        float stepSize=max(fieldStep,min(baseStep*growth,0.35+t*0.12));
        float nextT=min(t+stepSize,farT);
        vec3 nextP=ro+rd*nextT;
        float nextValue=nextP.y-seaHeight(nextP.xz);
        // Most intervals are plainly empty. Only a possible thin/grazing crest
        // needs denser front-to-back probes, so we cannot jump to a later wave.
        if(t<80.0 && abs(value)+abs(nextValue)<stepSize*1.6) {
            float beginT=t;
            float endT=nextT;
            float probeT=t;
            float probeValue=value;
            bool bracketed=false;
            for(int sampleIndex=1;sampleIndex<8;sampleIndex++) {
                float midT=mix(beginT,endT,float(sampleIndex)*0.125);
                vec3 midP=ro+rd*midT;
                float midValue=midP.y-seaHeight(midP.xz);
                if(probeValue*midValue<=0.0) {
                    t=probeT;
                    value=probeValue;
                    nextT=midT;
                    nextValue=midValue;
                    bracketed=true;
                    break;
                }
                probeT=midT;
                probeValue=midValue;
            }
            if(!bracketed && probeValue*nextValue<=0.0) {
                t=probeT;
                value=probeValue;
            }
        }
        if(value*nextValue<=0.0) {
            float left=t,right=nextT;
            float leftValue=value,rightValue=nextValue;
            for(int j=0;j<5;j++) {
                float ratio=clamp(leftValue/(leftValue-rightValue),0.15,0.85);
                float mid=mix(left,right,ratio);
                vec3 mp=ro+rd*mid;
                float midValue=mp.y-seaHeight(mp.xz);
                if(leftValue*midValue<=0.0) {right=mid;rightValue=midValue;}
                else {left=mid;leftValue=midValue;}
            }
            return mix(left,right,clamp(leftValue/(leftValue-rightValue),0.0,1.0));
        }
        if(nextT>=farT) return -1.0;
        t=nextT;
        value=nextValue;
        growth*=1.19;
    }
    // Caller may use a distant (80m+) average plane fallback for the horizon.
    return -1.0;
}

// One scene, one moving camera and one surface shared above and below water.
uniform sampler2D uSky;
uniform float uSkyReady;
uniform sampler2D uSurface;
uniform sampler2D uUnderwater;
uniform float uSurfaceReady;
uniform float uUnderwaterReady;

vec3 sky(vec3 rd) {
    float azimuth=atan(rd.x,max(rd.z,.05));
    vec2 tc=vec2(.523+azimuth/1.65,clamp(rd.y/.72,0.0,1.0));
    vec3 photograph=pow(texture2D(uSky,clamp(tc,vec2(.002),vec2(.998))).rgb,vec3(2.2));
    vec3 fallback=mix(vec3(.64,.36,.18),vec3(.21,.43,.65),smoothstep(0.0,.5,rd.y));
    photograph=mix(photograph,vec3(.46,.62,.73),.12);
    return mix(fallback,photograph*vec3(1.15,1.23,1.3),uSkyReady);
}

vec3 waterBody(vec3 rd,float depth) {
    float light=pow(max(rd.y*.5+.5,0.0),1.5);
    return mix(vec3(.001,.020,.060),vec3(.008,.17,.31),light)*exp(-depth*.035);
}

vec3 shadeSurface(vec3 ro,vec3 rd,float hit,float wet) {
    vec3 point=ro+rd*hit;
    float footprint=max(.0006,hit*1.3/uResolution.y);
    vec3 n=seaNormal(point.xz,footprint);
    vec3 sun=normalize(vec3(.58,.043,1.0));
    if(wet<.5) {
        float ndv=max(dot(n,-rd),0.0);
        float fresnel=.0204+.9796*pow(1.0-ndv,5.0);
        vec3 reflected=reflect(rd,n);
        vec3 reflection=sky(vec3(reflected.x,abs(reflected.y),reflected.z));
        // The reflected horizon is pale blue except in the low solar lobe.
        float solarAzimuth=exp(-pow((atan(reflected.x,max(reflected.z,.05))-.525)*3.0,2.0));
        reflection=mix(reflection*vec3(.65,.94,1.12),reflection,solarAzimuth);
        float crest=smoothstep(.02,.37,point.y);
        vec3 water=vec3(.0018,.018,.027)+vec3(.001,.024,.024)*crest;
        vec3 col=mix(water,reflection,fresnel);
        // View-dependent radiance material, advected by the live wave normals.
        // Geometry, silhouettes, camera and optics are still evaluated per ray.
        float distanceForward=max(point.z-ro.z,.2);
        vec2 materialUV=vec2(.5+(point.x-ro.x)/(distanceForward*2.35),
                             1.0-pow(1.0/(1.0+hit*.4),.72));
        // Near the lens, blend to a projection with a finite footprint so
        // nearby waves do not stretch a single texture row into gold stripes.
        float nearLens=1.0-smoothstep(.12,.60,abs(ro.y));
        materialUV.y=mix(materialUV.y,.10+gl_FragCoord.y/uResolution.y*.8,nearLens);
        vec2 materialFlow=vec2(n.x*.014,n.z*.018);
        materialFlow+=vec2(sin(materialUV.y*14.0+uTime*.43),sin(materialUV.x*11.0-uTime*.37))*.003;
        vec3 radiance=pow(texture2D(uSurface,clamp(materialUV+materialFlow,vec2(.003),vec2(.997))).rgb,vec3(2.2));
        radiance*=.86+clamp(n.y,0.0,1.0)*.14;
        col=mix(col,radiance,uSurfaceReady*.88);
        vec3 h=normalize(sun-rd);
        float nh=max(dot(n,h),0.0), nl=max(dot(n,sun),.0);
        float rough=.064+smoothstep(.012,.10,footprint)*.045;
        float r2=rough*rough;
        float denom=nh*nh*(r2-1.0)+1.0;
        float distribution=r2/(PI*denom*denom+.000002);
        float sunlight=min(distribution*.55*nl/max(ndv,.08),15.0);
        col+=vec3(1.0,.90,.67)*sunlight;
        // Small occasional aerated crests; the open sea isn't covered in foam.
        float foam=smoothstep(.34,.48,point.y)*smoothstep(.66,.86,noise21(point.xz*8.3+uTime*.11));
        col=mix(col,vec3(.42,.48,.43),foam*.22);
        float haze=1.0-exp(-hit*.003);
        return mix(col,sky(vec3(rd.x,.008,rd.z)),haze*.5);
    }
    // Snell refraction and total internal reflection reveal the moving ceiling.
    vec3 refracted=refract(rd,-n,1.333);
    float transmission=step(.01,dot(refracted,refracted));
    float cosine=max(dot(n,rd),0.0);
    float transmittedCosine=sqrt(max(1.0-1.333*1.333*(1.0-cosine*cosine),0.0));
    float rs=(1.333*cosine-transmittedCosine)/max(1.333*cosine+transmittedCosine,.0001);
    float rp=(cosine-1.333*transmittedCosine)/max(cosine+1.333*transmittedCosine,.0001);
    float fresnel=clamp((rs*rs+rp*rp)*.5,0.0,1.0);
    vec3 reflected=reflect(rd,-n);
    float detail=noise21(point.xz*4.8+uTime*.05);
    float fold=pow(clamp(n.y*.6+n.z*.6+.25,0.0,1.0),3.0);
    vec3 internal=waterBody(reflected,-ro.y)*(1.2+detail*.8);
    internal+=vec3(.003,.055,.105)*fold;
    float warmWindow=pow(max(dot(refracted,sun),0.0),12.0);
    vec3 diffuseSky=vec3(.23,.45,.66)+vec3(.50,.24,.02)*warmWindow;
    vec3 beyond=mix(sky(refracted),diffuseSky,.82)*vec3(.65,.88,1.0);
    beyond+=vec3(1.0,.90,.68)*pow(max(dot(refracted,sun),0.0),480.0)*8.0;
    // Unresolved facets spread the Snell window over a finite angular width.
    // This supplies the silver underside glints that a perfectly smooth
    // dielectric heightfield loses between its sharp total-reflection patches.
    float facet=pow(clamp(cosine+.18,0.0,1.0),7.0);
    internal+=vec3(.06,.18,.25)*facet*(.5+detail);
    vec3 ceiling=mix(internal,beyond,transmission*(1.0-fresnel));
    float ripple=pow(max(dot(n,normalize(vec3(.28,1.0,.4))),0.0),9.0);
    ceiling+=vec3(.001,.027,.033)*ripple;
    vec3 extinction=exp(-vec3(.18,.048,.032)*hit);
    return ceiling*extinction+waterBody(rd,-ro.y)*(1.0-extinction);
}

vec3 underwaterLight(vec3 ro,vec3 rd,float maxDistance) {
    // Light is sampled in world space, so beams move with the camera and waves.
    vec3 light=normalize(vec3(.42,.74,.56));
    float scatter=0.0;
    float distance=min(maxDistance,18.0);
    for(int i=0;i<7;i++) {
        if(i==5&&uQuality<.4) break;
        float travel=(float(i)+.35)*distance/7.0;
        vec3 pos=ro+rd*travel;
        vec2 atSurface=pos.xz-pos.y*light.xz/light.y;
        float a=noise21(atSurface*.7+vec2(uTime*.09,-uTime*.035));
        float b=noise21(atSurface*2.1+vec2(-uTime*.04,uTime*.07));
        float focus=pow(clamp(a*.8+b*.35,0.0,1.0),5.0);
        scatter+=focus*exp(min(pos.y,0.0)*.2-travel*.07);
    }
    float phase=.24+pow(max(dot(rd,light),0.0),5.0)*.75;
    return vec3(.025,.25,.36)*scatter*phase*(distance/18.0);
}

vec3 scene(vec2 uv,float progress) {
    float dive=smoothstep(.10,.64,progress);
    float deep=smoothstep(.58,1.0,progress);
    float eye=mix(1.10,-1.2,dive)-deep*2.0;
    vec3 ro=vec3(uMouse.x*.05,eye,uTime*.06+progress*3.8);
    float localSea=seaHeight(ro.xz);
    // A small vertical lens aperture straddles the real wave, instead of wiping
    // two unrelated images with an invented 2D boundary.
    float aperture=.17*(1.0-smoothstep(.25,.7,abs(eye-localSea)));
    ro.y+=uv.y*aperture;
    ro.x+=uv.x*aperture*.3;
    localSea=seaHeight(ro.xz);
    float wet=step(ro.y,localSea);
    float pitch=mix(.215,.28,dive)+deep*.09;
    float portraitYaw=.40*(1.0-smoothstep(.65,1.3,uResolution.x/uResolution.y));
    vec3 forward=normalize(vec3(portraitYaw+uMouse.x*.011,pitch,1.0));
    vec3 right=normalize(cross(vec3(0.0,1.0,0.0),forward));
    vec3 up=cross(forward,right);
    float nearSurface=exp(-abs(ro.y-localSea)*9.0);
    vec2 lens=uv;
    lens+=vec2(noise21(uv*6.0+uTime*.8)-.5,noise21(uv*5.0-uTime*.6)-.5)*nearSurface*.018;
    vec3 rd=normalize(forward*1.55+right*lens.x+up*(lens.y+uMouse.y*.008));
    float hit=traceSea(ro,rd);
    float flatDistance=-ro.y/rd.y;
    if(hit<0.0&&flatDistance>60.0) hit=min(flatDistance,800.0);
    vec3 color=wet>.5?waterBody(rd,-ro.y):sky(rd);
    if(hit>0.0) color=shadeSurface(ro,rd,hit,wet);
    if(wet>.5) {
      float aspect=uResolution.x/uResolution.y;
      vec2 photoUV=vec2(.5+uv.x/3.5556,.5+uv.y*.5);
      photoUV.x+=.14*(1.0-smoothstep(.65,1.3,aspect));
      // Keep an overscan margin for the normal-driven flow at the lens edge.
      photoUV=.5+(photoUV-.5)*(.93-deep*.015);
      vec2 flow=vec2(sin(uv.y*3.0+uTime*.27),cos(uv.x*2.4-uTime*.22))*.004;
      if(hit>0.0) {
        vec3 surfaceNormal=seaNormal((ro+rd*hit).xz,max(.001,hit/uResolution.y));
        flow+=surfaceNormal.xz*vec2(.024,.016)*smoothstep(.0,.8,photoUV.y);
      }
      vec3 radiance=pow(texture2D(uUnderwater,clamp(photoUV+flow,vec2(.003),vec2(.997))).rgb,vec3(2.2));
      color=mix(color,radiance,uUnderwaterReady*.91);
      color+=underwaterLight(ro,rd,hit>0.0?hit:20.0);
      for(int i=0;i<16;i++) {
        float id=float(i)+1.0;
        vec2 seed=vec2(hash21(vec2(id,8.3)),hash21(vec2(id,18.2)));
        vec2 center=(fract(seed+vec2(sin(uTime*.12+id)*.008,uTime*(.003+seed.x*.004)+progress*.23))*2.0-1.0)*vec2(uResolution.x/uResolution.y,1.0);
        float radius=.001+seed.x*.0017;
        float speck=exp(-dot(uv-center,uv-center)/(radius*radius));
        color+=vec3(.12,.24,.30)*speck*(.2+seed.y*.3);
      }
    }
    // Meniscus briefly softens contrast only at physical lens/water contact.
    float meniscus=exp(-pow((ro.y-localSea+.015)/.055,2.0));
    color=mix(color,vec3(.003,.022,.035),meniscus*.85);
    color=mix(color,color*.82+vec3(.005,.016,.018),nearSurface*.3);
    return color;
}

void main() {
    vec2 uv=(gl_FragCoord.xy*2.0-uResolution.xy)/uResolution.y;
    float p=clamp(uProgress,0.0,1.0);
    vec3 color=scene(uv,p);
    color=max(color,vec3(0.0));
    // Preserve the sky's photographic color; compress only HDR sun highlights.
    color=color/(1.0+color*.32);
    color=pow(color,vec3(.4545));
    color*=1.0-clamp(dot(uv*vec2(.23,.28),uv*vec2(.23,.28))*.10,0.0,.08);
    color+=(hash21(gl_FragCoord.xy+fract(uTime)*23.0)-.5)/255.0;
    float defocus=smoothstep(.1,1.0,-uv.y)*(1.0-smoothstep(.34,.53,p));
    float cameraHeight=mix(1.10,-1.2,smoothstep(.10,.64,p))-smoothstep(.58,1.0,p)*2.0;
    float cameraSea=seaHeight(vec2(uMouse.x*.05,uTime*.06+p*3.8));
    float contact=exp(-pow((cameraHeight-cameraSea)/.15,2.0));
    gl_FragColor=vec4(color,clamp(defocus*.20+contact*.95,0.0,1.0));
}
