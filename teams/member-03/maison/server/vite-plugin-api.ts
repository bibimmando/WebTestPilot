import type { Connect, Plugin, PreviewServer, ViteDevServer } from "vite";

/**
 * /api/* 를 Vite 개발·프리뷰 서버에 직접 붙인다.
 *
 * 별도 Express 프로세스를 띄우면 포트가 둘로 갈라져 CORS 와 proxy 설정이
 * 따라붙고, 크롤러·벤치마크도 프로세스를 두 개 관리해야 한다.
 * 미들웨어로 넣으면 `npm run dev` 하나로 화면과 API 가 같은 포트에서 돈다.
 */
export function apiPlugin(): Plugin {
  const middleware: Connect.NextHandleFunction = async (req, res, next) => {
    // 핸들러를 매 요청마다 불러와 수정이 재시작 없이 반영되게 한다.
    const { handleApi } = await import("./api");
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

  return {
    name: "maison-api",
    configureServer: attach,
    configurePreviewServer: attach,
  };
}
