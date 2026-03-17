import path from "path";
import { fileURLToPath } from "url";
import { buildApp } from "./app.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "../../data/linkedin.db");
const PORT = 3210;

const app = buildApp(DB_PATH);

app.listen({ port: PORT, host: "0.0.0.0" }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`LinkedIn Analytics server running at ${address}`);
});
