import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { apiPlugin } from "./server/vite-plugin-api";

// 화면과 API 가 한 포트(8090)에서 돈다. Maison 과 같은 구조다.
export default defineConfig({
  server: { host: "127.0.0.1", port: 8090, strictPort: true },
  preview: { host: "127.0.0.1", port: 8090, strictPort: true },
  plugins: [react(), apiPlugin()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
