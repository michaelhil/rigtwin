// Rig viewer (TypeScript, bundled by tools/bundle.ts into one static module). Reads <asset>/<name>.glb
// and <name>.manifest.json. Joint posing uses the shared definition in shared/pose.ts, the same code
// the generator uses when it writes the GLB.
//
//   engine.ts    renderer, model, visibility, joints, cameras, highlight; the `viewer.*` interface
//   interact.ts  pointer on the 3D view: point, click, double-click, drag a selected part
//   ui.ts        parts list, card for the selected part, notices, More, keys, link and picture
//   words.ts     plain-language names of parts and adjustments
//
// URL parameters (all optional; lists are comma-separated; ids may be component ids, group names, or
// the units joystick_L, joystick_R, touchscreen):
//   view=three_quarter|front|rear|left|right|top|front_quarter|operator    proj=ortho|persp
//   camera=px,py,pz,tx,ty,tz[,fovDeg]      explicit camera in the model frame
//   cam=IMG_2530                           photo-matched camera from private/evidence/cameras.json (if present)
//   overlay=none|photo|blend|outline       how the photo is shown with cam=
//   only=a,b   hide=a,b                    visibility          fit=a,b   frame the view on these instead of the whole rig
//   pose=J_x:val,...                       degrees for revolute, metres for prismatic, roll/pitch/yaw degrees for ball (J_b:0/25/0)
//   mode=normal|ids|class   wire=1   frames=1   legend=1   hud=1   caption=text   ui=0
//   sel=<id>                               selected row, unit or part (the page shows its card)
//   asset=<dir>  name=<asset name>         where the GLB and manifest are (default asset/rig-b)
// Wireframe, orthographic projection, reference frames and the id legend have no control on the page;
// they stay available here for scripts and agents. The page keeps the address in step with what is on
// screen (camera, hidden parts, selection, adjustments), so a copied link reproduces the view.
import { Q, apply, load, layout, status, stageEl, viewerApi, invalidate } from './engine.ts';
import { initUi } from './ui.ts';

declare global { interface Window { viewer: typeof viewerApi; viewerReady?: boolean; viewerError?: string } }

(async () => {
  try {
    await load();
    initUi();
    new ResizeObserver(() => layout()).observe(stageEl);
    // a window dragged to a screen with another pixel density keeps the right sharpness
    const watchDensity = () => window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener('change', () => { layout(); watchDensity(); }, { once: true });
    watchDensity();
    document.addEventListener('visibilitychange', () => { if (!document.hidden) invalidate(); });
    await apply(Object.fromEntries(Q));
    status(null);
    window.viewer = viewerApi; window.viewerReady = true;
  } catch (e) {
    console.error(e);
    const msg = e instanceof Error ? e.message : String(e);
    status(msg, true);
    window.viewerError = msg;
  }
})();
