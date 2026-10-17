# 승인 후 라우트 배선 메모

현재 `src/index.js`에는 다른 작업의 미커밋 변경이 있으므로 자동 패치를 적용하지 않았다. 승인된 최신 기준에서 아래 두 삽입만 수동 통합하고 전체 체크아웃을 그대로 배포하지 않는다.

기존 서비스 모듈 import 옆:

```js
import { growthPanelRoute } from "./growth-panel-service.mjs";
```

`fetch` 핸들러가 `path`를 만든 직후, 일반 404 처리 전:

```js
if (path.startsWith("/api/growth-panel/")) {
  return growthPanelRoute(
    req,
    env,
    cors,
    path.slice("/api/growth-panel/".length),
    { json, requireUser, sbFetch },
  );
}
```

같은 배포에서 `ALLOWED_ORIGINS`에 `https://english.literstella.co.kr`을 추가하고 기존 origin을 보존한다. 브라우저가 보내는 사용자 ID·이메일·소장 개수는 권한 판정에 사용하지 않는다.
