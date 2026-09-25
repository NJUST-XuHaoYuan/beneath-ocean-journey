# OCEAN · Closer to the ocean

滚动控制镜头，从日落海面穿过浪头潜入水下。采用写实材质与实时 WebGL 相结合的方案：生成的静态天空、海面和水下光色材质提供细节，代码计算海浪高度场、镜头运动、纹理流动、反射折射、光散射与景深。没有视频、视频帧序列，也没有使用原视频截图作为素材。

## 体验

- 滚动或触摸滑动下潜，向上滚动返回。
- 顶部“海面 / 入水 / 水下”定位；主按钮进入水下。
- 左下角暂停或恢复环境运动，暂停后仍可改变下潜位置。
- 支持系统“减少动态效果”，并在低帧率时自动降低像素预算。

## 本地运行

在仓库根目录运行：

```sh
python3 -m http.server 4173 --directory dist
```

然后打开 http://localhost:4173 。源码版使用本地服务器加载三张材质。无需安装第三方依赖；浏览器需支持 WebGL 和硬件加速。

使用 Node.js 可生成能直接双击打开的独立 HTML：

```sh
node scripts/build-shader.mjs
node scripts/build-standalone.mjs
```

打开生成的 `release/ocean.html` 即可，材质、字体和脚本全部内嵌。任意静态网站服务均可托管 `dist/` 目录。

## 修改

- `src/ocean.frag` 是可编辑的海洋 GLSL；修改后运行 `node scripts/build-shader.mjs`。
- `dist/app.js` 管理相机、交互、材质加载和景深后处理。
- `scripts/build-standalone.mjs` 将网页与资源打包成单文件 HTML。
- `dist/style.css` 和 `dist/index.html` 管理布局。
- `dist/sky.jpg`、`dist/surface.jpg`、`dist/underwater.jpg` 由内置 image_gen 生成；提示词保存在 `src/*.prompt.txt`。它们提供天空和水体的写实光色，不是录像。
- 本地 Manrope 字体许可见 `dist/FONT-LICENSE.txt`。

## 本次修正依据与限制

实际查看了用户提供的抖音视频 7688898157900907987 的海面、近浪、半入水和水下关键帧。相较初版，重做了暖日落构图、固定衬线文字、低机位多方向厚浪和连续下潜。海面与水下使用同一高度场定位水线，包含 Snell 折射、全反射和世界空间散射；穿越水面时采用有限镜头口径、折射扰动和景深。写实材质与实时光学混合，减少纯程序水体的塑料感和重复条纹。

原片标注“作品含 AI 生成内容”，无法从视频确定其真实技术实现。本项目为可实时交互的近似重建，未声称逐帧一致；写实细节部分来自生成材质，未模拟完整流体破碎、卷浪和气液耦合。高度场求交在极远、极近平行视角下也可能略过很薄的浪尖。
