// Browser entry point. Everything interesting lives in src/ui/app.js.
import { createApp } from './ui/app.js';

const root = document.getElementById('app');
const app = createApp(root);
// Handy for debugging from the console: `h3.ctx.state`, `h3.showScreen('encyclopedia')`.
window.h3 = app;
app.start().catch((err) => app.showError(err));
