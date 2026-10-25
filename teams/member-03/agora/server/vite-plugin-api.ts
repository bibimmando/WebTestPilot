import type { Connect, Plugin, PreviewServer, ViteDevServer } from "vite";
import { handleApi } from "./api";

/**
 * /api/* 를 Vite 개발·프리뷰 서버에 직접 붙인다 (Maison 과 같은 방식).
 * `npm run dev` 하나로 화면과 API 가 같은 포트에서 돈다.
 */
export function apiPlugin(): Plugin {
  const middleware: Connect.NextHandleFunction = async (req, res, next) => {
    try {
      const handled = await handleApi(req, res);
      if (!handled) next();
    } catch (err) {
      res.statusCode = 500;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ error: "internal", message: String(err) }));
    }
  };

  const attach = (server: ViteDevServer | PreviewServer) => {
    server.middlewares.use(middleware);
  };

  return { name: "agora-api", configureServer: attach, configurePreviewServer: attach };
}
