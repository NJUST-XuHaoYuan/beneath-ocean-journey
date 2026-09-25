/* OCEAN — live wave geometry and optics with generated photographic radiance materials. No video. */
(() => {
  'use strict';
  const canvas = document.getElementById('ocean');
  const fallback = document.getElementById('fallback');
  const pauseButton = document.getElementById('pause');
  const depthValue = document.getElementById('depth-value');
  const marker = document.getElementById('depth-marker');
  const track = document.querySelector('.depth-track');
  const locationLabel = document.getElementById('location-label');
  const cueLabel = document.getElementById('cue-label');
  const diveButton = document.getElementById('dive');
  const navButtons = [...document.querySelectorAll('.chapters button')];
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let paused = reduceMotion.matches;
  let motionPreference = reduceMotion.matches;
  let progress = 0, target = 0, elapsed = 0, last = 0, frame = 0;
  let maxScroll = 1, pixelScale = 1, slowFrames = 0, totalFrames = 0;
  let mouse = [0, 0], pointer = [0, 0], dirty = true, visible = true;
  let gl, program, uniforms, buffer, contextLost = false, width = 0, height = 0;
  let currentStage = -1;
  let postProgram, postUniforms, sceneTexture, sceneBuffer, skyTexture;
  const materialTextures=[];
  let diveVelocity = 0, splashStarted = -100, splashStrength = 0;
  const vertex = 'attribute vec2 aPosition;varying vec2 vUv;void main(){vUv=aPosition*.5+.5;gl_Position=vec4(aPosition,0.0,1.0);}';
  function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const reason = gl.getShaderInfoLog(shader); gl.deleteShader(shader);
      throw new Error(reason);
    }
    return shader;
  }
  function initialize() {
    gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL unavailable');
    let source = window.OCEAN_FRAGMENT;
    if (!source) throw new Error('Ocean shader missing');
    const precision = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
    if (!precision || !precision.precision) source = source.replace('precision highp float;', 'precision mediump float;');
    const vs = compile(gl.VERTEX_SHADER, vertex), fs = compile(gl.FRAGMENT_SHADER, source);
    program = gl.createProgram(); gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    gl.deleteShader(vs); gl.deleteShader(fs); gl.useProgram(program);
    buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
    const pos = gl.getAttribLocation(program, 'aPosition'); gl.enableVertexAttribArray(pos); gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
    uniforms = Object.fromEntries(['uResolution','uTime','uProgress','uMouse','uQuality','uDiveVelocity','uSplashAge','uImpact','uSky','uSkyReady','uSurface','uUnderwater','uSurfaceReady','uUnderwaterReady'].map(name => [name, gl.getUniformLocation(program, name)]));
    const postFragment = `precision mediump float;
      varying vec2 vUv; uniform sampler2D uScene; uniform vec2 uPixel;
      void main(){
        vec4 center=texture2D(uScene,vUv);
        float radius=center.a*14.0;
        vec3 sum=center.rgb; float total=1.0;
        for(int i=0;i<12;i++){
          float angle=float(i)*2.399963;
          vec2 offset=vec2(cos(angle),sin(angle))*sqrt((float(i)+.5)/12.0)*radius*uPixel;
          vec3 c=texture2D(uScene,vUv+offset).rgb;
          float weight=1.0+pow(max(max(c.r,c.g),c.b),5.0)*2.0;
          sum+=c*weight; total+=weight;
        }
        gl_FragColor=vec4(sum/total,1.0);
      }`;
    const postVs=compile(gl.VERTEX_SHADER,vertex), postFs=compile(gl.FRAGMENT_SHADER,postFragment);
    postProgram=gl.createProgram(); gl.attachShader(postProgram,postVs); gl.attachShader(postProgram,postFs); gl.linkProgram(postProgram);
    if(!gl.getProgramParameter(postProgram,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(postProgram));
    gl.deleteShader(postVs); gl.deleteShader(postFs);
    postUniforms={scene:gl.getUniformLocation(postProgram,'uScene'),pixel:gl.getUniformLocation(postProgram,'uPixel')};
    sceneTexture=gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D,sceneTexture);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    sceneBuffer=gl.createFramebuffer();
    const texture = gl.createTexture(); skyTexture=texture;
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([127,166,191,255]));
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.uniform1i(uniforms.uSky,0); gl.uniform1f(uniforms.uSkyReady,0);
    const skyImage = new Image();
    skyImage.onload = () => {
      if(contextLost) return;
      gl.useProgram(program); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,skyImage);
      gl.uniform1f(uniforms.uSkyReady,1); dirty=true;
    };
    skyImage.src=window.OCEAN_SKY || 'sky.jpg';
    materialTextures.length=0;
    for(const [index,name,source] of [[1,'Surface',window.OCEAN_SURFACE||'surface.jpg'],[2,'Underwater',window.OCEAN_UNDERWATER||'underwater.jpg']]) {
      const materialTexture=gl.createTexture();
      materialTextures.push({index,texture:materialTexture});
      gl.activeTexture(gl.TEXTURE0+index);gl.bindTexture(gl.TEXTURE_2D,materialTexture);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([15,67,92,255]));
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.uniform1i(uniforms['u'+name],index);gl.uniform1f(uniforms['u'+name+'Ready'],0);
      const materialImage=new Image();
      materialImage.onload=()=>{
        if(contextLost)return;
        gl.useProgram(program);gl.activeTexture(gl.TEXTURE0+index);gl.bindTexture(gl.TEXTURE_2D,materialTexture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,materialImage);
        gl.uniform1f(uniforms['u'+name+'Ready'],1);dirty=true;
      };
      materialImage.src=source;
    }
    gl.activeTexture(gl.TEXTURE0);
    resize(); fallback.hidden = true; contextLost = false;
  }
  function resize() {
    maxScroll = Math.max(1, document.documentElement.scrollHeight - innerHeight);
    const mobile = innerWidth < 700;
    const budget = mobile ? 550000 : 1250000;
    const density = Math.min(devicePixelRatio || 1, mobile ? 1.5 : 1.35, Math.sqrt(budget / (innerWidth * innerHeight))) * pixelScale;
    width = Math.max(1, Math.round(innerWidth * density)); height = Math.max(1, Math.round(innerHeight * density));
    canvas.width = width; canvas.height = height;
    if (gl) {
      gl.viewport(0,0,width,height);
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,sceneTexture);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,width,height,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
      gl.bindFramebuffer(gl.FRAMEBUFFER,sceneBuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,sceneTexture,0);
      if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE) throw new Error('Ocean framebuffer incomplete');
      gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    }
    target = Math.min(1, Math.max(0, scrollY / maxScroll)); dirty = true;
    updateHUD();
  }
  function updateHUD() {
    const depth = Math.max(0, (progress - .38) / .62);
    const value = (depth * 3.2).toFixed(1);
    if (depthValue.textContent !== value) depthValue.textContent = value;
    document.body.style.setProperty('--depth-opacity', Math.min(depth * 4, .75));
    document.body.classList.toggle('submerged',progress > .36);
    const stage = progress < .25 ? 0 : progress < .52 ? 1 : 2;
    if (stage !== currentStage) {
      currentStage = stage;
      locationLabel.textContent = ['LIVE AT SEA', 'AT THE WATERLINE', 'BENEATH THE SURFACE'][stage];
      cueLabel.textContent = ['SCROLL TO EXPLORE', '继续向下，穿过水面', '向上滚动，回到海面'][stage];
      diveButton.dataset.jump = ['0.72', '0.82', '0'][stage];
      navButtons.forEach((button, i) => i === stage ? button.setAttribute('aria-current', 'location') : button.removeAttribute('aria-current'));
    }
  }

  function updatePause() {
    pauseButton.setAttribute('aria-pressed', String(paused));
    pauseButton.setAttribute('aria-label', paused ? '继续海洋动画' : '暂停海洋动画');
    document.body.classList.toggle('paused', paused);
    dirty = true;
  }
  function render(timestamp) {
    if (!visible || contextLost) { frame = 0; return; }
    if(reduceMotion.matches !== motionPreference) {
      motionPreference=reduceMotion.matches; paused=motionPreference; updatePause();
    }
    const dt = last ? Math.min((timestamp - last) / 1000, .08) : .016;
    last = timestamp;
    const moving = Math.abs(target - progress) > .00004;
    const previousProgress = progress;
    if (reduceMotion.matches) progress = target;
    else progress += (target - progress) * (1 - Math.exp(-dt * 6.5));
    if (!paused) elapsed += dt;
    const velocity = (progress - previousProgress) / Math.max(dt, .001);
    diveVelocity += (velocity - diveVelocity) * (1 - Math.exp(-dt * 9));
    const crossedSurface = (previousProgress < .38 && progress >= .38) || (previousProgress > .38 && progress <= .38);
    if (crossedSurface && !paused && !reduceMotion.matches && Math.abs(velocity) > .007) {
      splashStarted = elapsed;
      splashStrength = Math.min(1, .28 + Math.abs(velocity) * 2.5);
    }
    const ease = 1 - Math.exp(-dt * 2.8);
    mouse[0] += (pointer[0] - mouse[0]) * ease; mouse[1] += (pointer[1] - mouse[1]) * ease;
    if (!paused || moving || dirty) {
      gl.bindFramebuffer(gl.FRAMEBUFFER,sceneBuffer); gl.useProgram(program);
      for(const item of materialTextures){gl.activeTexture(gl.TEXTURE0+item.index);gl.bindTexture(gl.TEXTURE_2D,item.texture);}
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,skyTexture);
      const scenePos=gl.getAttribLocation(program,'aPosition');
      gl.enableVertexAttribArray(scenePos);gl.vertexAttribPointer(scenePos,2,gl.FLOAT,false,0,0);
      gl.uniform2f(uniforms.uResolution, width, height);
      gl.uniform1f(uniforms.uTime, elapsed);
      gl.uniform1f(uniforms.uProgress, progress);
      gl.uniform2f(uniforms.uMouse, reduceMotion.matches ? 0 : mouse[0], reduceMotion.matches ? 0 : mouse[1]);
      gl.uniform1f(uniforms.uQuality, innerWidth < 700 || pixelScale < .8 ? .35 : .85);
      gl.uniform1f(uniforms.uDiveVelocity, reduceMotion.matches ? 0 : diveVelocity);
      gl.uniform1f(uniforms.uSplashAge, elapsed - splashStarted);
      gl.uniform1f(uniforms.uImpact, reduceMotion.matches ? 0 : splashStrength);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.bindFramebuffer(gl.FRAMEBUFFER,null); gl.useProgram(postProgram);
      gl.bindTexture(gl.TEXTURE_2D,sceneTexture);
      gl.uniform1i(postUniforms.scene,0); gl.uniform2f(postUniforms.pixel,1/width,1/height);
      const postPos=gl.getAttribLocation(postProgram,'aPosition');
      gl.enableVertexAttribArray(postPos);gl.vertexAttribPointer(postPos,2,gl.FLOAT,false,0,0);
      gl.drawArrays(gl.TRIANGLES,0,6);
      updateHUD(); dirty = false;
      totalFrames++;
      if (totalFrames > 90) slowFrames = dt > .036 ? slowFrames + 1 : Math.max(0, slowFrames - .3);
      if (slowFrames > 70 && pixelScale > .62) { pixelScale *= .82; slowFrames = 0; resize(); }
    }
    frame = requestAnimationFrame(render);
  }
  function start() { if (!frame && !contextLost && visible) { last = 0; frame = requestAnimationFrame(render); } }
  addEventListener('scroll', () => { target = Math.min(1, Math.max(0, scrollY / maxScroll)); dirty = true; }, { passive: true });
  addEventListener('resize', resize, { passive: true });
  addEventListener('pointermove', event => { if (event.pointerType !== 'mouse') return; pointer = [(event.clientX / innerWidth - .5) * 2, (event.clientY / innerHeight - .5) * 2]; if (!paused) dirty = true; }, { passive: true });
  document.addEventListener('pointerleave', () => { pointer = [0, 0]; });
  document.addEventListener('visibilitychange', () => { visible = !document.hidden; if (visible) start(); else if (frame) { cancelAnimationFrame(frame); frame = 0; } });
  document.querySelectorAll('[data-jump]').forEach(button => button.addEventListener('click', () => {
    scrollTo({ top: Number(button.dataset.jump) * maxScroll, behavior: reduceMotion.matches ? 'instant' : 'smooth' });
  }));
  document.querySelector('.brand').addEventListener('click', event => { event.preventDefault(); scrollTo({top:0,behavior:reduceMotion.matches?'instant':'smooth'}); });
  pauseButton.addEventListener('click', () => { paused = !paused; updatePause(); });
  reduceMotion.addEventListener('change', event => { motionPreference=event.matches; paused=event.matches; updatePause(); });
  canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); contextLost = true; if (frame) cancelAnimationFrame(frame); frame = 0; fallback.hidden = false; });
  canvas.addEventListener('webglcontextrestored', () => { try { initialize(); dirty = true; start(); } catch (error) { console.error(error); fallback.hidden = false; } });
  window.__ocean = { get state() { return { progress, target, elapsed, paused, width, height, pixelScale, contextLost, diveVelocity, splashAge: elapsed - splashStarted, splashStrength, frames: totalFrames, renderer: gl?.getParameter(gl.RENDERER) }; } };
  try { initialize(); updatePause(); start(); } catch (error) { console.error('Ocean rendering:', error); fallback.hidden = false; }
})();
