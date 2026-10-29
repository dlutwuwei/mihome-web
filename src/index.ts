import { createApp } from "./app.js";
import { bootstrapProviders } from "./providers/index.js";

bootstrapProviders();

const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "127.0.0.1";
const app = createApp();

app.listen(port, host, () => {
  console.log(`http://${host}:${port}`);
});
