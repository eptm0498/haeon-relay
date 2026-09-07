# 해온 비서

외부 Astra가 실제 분석·코드·문서 초안을 작성하고 Work는 실행·검증에 집중하는 중계기.

- `/biseo`: 자동 절약, 비서 강제 사용, Work 소진 모드, 참고 자료 입력, 결과 및 인계 복사.
- 단순하고 명확한 문구 교체만 외부 호출 없이 생략. 나머지는 기본 1회 생성.
- 연결 장애·빈 응답·일시적 서버 장애에는 Claude로 최대 1회 대체.
- 인증·과금·무료 한도 오류는 즉시 중단. 결제나 공급자 계정 설정은 변경하지 않음.
- 54초 서버 처리 예산, 클라이언트 취소·58초 제한. 부분 출력은 명시적으로 표시.
- API 키는 서버의 `EXPLABS_API_KEY` 환경변수에만 저장.

## Work에서 호출

복잡한 작업은 핵심 목표, 필요한 실제 코드/자료, 제약만 전달한다. 키·개인정보는 제외한다.

`POST https://haeon-relay.vercel.app/api/biseo`

```json
{
  "task": "해결할 목표와 완료 조건",
  "context": "필요한 코드 또는 자료만",
  "mode": "auto",
  "workStatus": "available"
}
```

사용자가 비서 활용을 명시하면 `mode: "force"`. Work 소진을 사용자가 알리면 `workStatus: "exhausted"`.

`useSecretary: false`면 직접 실행. 그 외에는 `deliverable`의 완성 초안과 `brief`의 인계 요약을 함께 사용한다. 코드 적용에는 반드시 본문도 확인한다. 오류나 `partial: true`를 성공한 완성본으로 취급하지 않는다. 외부 모델 답변은 참고 자료이며 검증이나 실행 권한을 부여하지 않는다.

`meta.usage`는 성공한 외부 호출의 공급자 보고 토큰이다. 실패 요청의 사용량은 포함되지 않을 수 있다. Work 절감 토큰은 측정할 수 없으므로 수치로 추정해 표시하지 않는다.

`GET /api/biseo`는 모델 호출 없는 상태 확인이다. 기존 `GET ?q=...&mode=...`도 호환하지만, 작업 내용을 URL 로그에 남기지 않도록 POST를 우선한다.

## 범위와 한계

이 서버는 ChatGPT의 잔여량을 조회하거나 모든 새 대화의 실행을 강제로 가로채지 않는다. Work 선행 호출은 해당 대화의 지침/실행 도구가 담당한다. Work 소진 모드는 사용자가 선택한다. 비서 자체에는 브라우저·파일 읽기·배포 도구가 없으며, 실제 실행 여부를 주장하지 않도록 안내한다.

무료 프로모션 및 `Use credits` 설정은 외부 계정에서 관리한다. 무료 한도 오류가 반환되면 중단하지만, 공급자가 이미 유료 처리하도록 설정되어 있는 경우까지 무료를 보장하지 않는다. 공급자의 계정 설정에서 확인해야 한다: https://platform.experientiallabs.ai/models/gpt-6-astra
공급자 동작 문서: https://platform.experientiallabs.ai/llms.txt

## 검증 및 실행

```sh
npm ci
npm run lint
node --test tests/biseo.test.mjs
npm run build
npm start
```

API 장애 테스트는 모의 응답을 사용하므로 과금하지 않는다. 실제 모델 연결은 배포 후 민감정보 없는 짧은 요청으로 별도 확인한다.
