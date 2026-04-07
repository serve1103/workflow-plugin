# Workflow Plugin — 프로젝트 프롬프트

## 목표
**입력부터 커밋까지** 전체 개발 흐름을 자동화하는 Claude Code 플러그인.
컨텍스트 보강 → 작업 수행 → 리뷰 → 사용자 확인 → 수정 → 검증 → 커밋의 엔드투엔드 파이프라인.
어떤 프로젝트에서든 `claude plugin install`로 설치하면 즉시 동작하는 범용 플러그인.

## 설계 원칙

| 원칙 | 근거 | 적용 |
|------|------|------|
| **훅은 트리거, 스킬이 오케스트레이션** | OMC 패턴 | 훅 스크립트는 3초 이내, 복잡한 흐름은 `/flow` 스킬에서 |
| **Writer/Reviewer 컨텍스트 분리** | Claude Code 공식 BP | 모든 에이전트를 서브에이전트로 실행 (격리된 컨텍스트) |
| **결정론적 검사 > 주관적 판단** | Anthropic 공식 BP | Verify는 도구 실행 결과로만 판단, Review는 에이전트 분석 |
| **에이전트 권한은 tools 허용 목록으로 제한** | 실제 플러그인 API | `tools: [Read, Grep, Glob]`으로 허용 도구만 명시. 목록에 없는 도구는 자동 차단 |
| **Human-in-the-Loop** | 에이전틱 코딩 BP | 리뷰 결과 확인, 대규모 변경 승인 등 핵심 지점에서 사용자 판단 |
| **변경 규모에 비례하는 파이프라인** | Anthropic: 단순성 우선 | 3줄 이하 변경은 리뷰만, 대규모 변경은 풀 파이프라인 |
| **롤백 우선** | 바이브코딩 BP | 파이프라인 시작 전 git stash/branch로 체크포인트 |
| **결정론적 로직은 코드로, 오케스트레이션은 LLM으로** | 비판적 검토 결과 | 프리셋 판단/리뷰어 선택은 Node.js, 에이전트 호출은 SKILL.md |

## 핵심 컨셉

### 2단계 파이프라인

```
[Phase 1: Pre-Work — 작업 전]

  (A) 자동 컨텍스트 보강 (훅, 경량)
      사용자가 프롬프트 입력
          ↓
      UserPromptSubmit 훅이 키워드/파일 경로 감지 (3초 이내)
          ↓
      system-reminder로 관련 컨텍스트 주입
      (프로젝트 구조, 코딩 규칙, 관련 파일 힌트)
          ↓
      원본 프롬프트 + 보강된 컨텍스트로 Claude가 작업 수행

  (B) 명시적 프롬프트 강화 (스킬, 중량)
      /flow enhance "로그인 고쳐줘"
          ↓
      인핸서 에이전트가 코드베이스 탐색 (시간 제한 없음)
          ↓
      강화된 프롬프트 생성 → 사용자 승인/수정
          ↓
      승인된 프롬프트로 Claude가 작업 수행

        ↓

[Phase 2: Post-Work — 작업 후]
    [체크포인트] git stash 또는 브랜치 생성 (롤백 지점)
        ↓
    [리뷰] 도메인별 리뷰어 자동 선택 → 병렬 실행 → 결과 합산
        ↓
    [사용자 확인] ★ 리뷰 결과 보고 → 사용자가 진행 방식 결정
        ↓ (사용자 선택에 따라)
    [수정] 사용자가 승인한 이슈만 자동 수정 (동일 에러 3회 → 중단)
        ↓
    [검증] 린트, 타입체크, 빌드, 테스트 (결정론적 도구 실행)
        ↓
    [커밋] 변경 요약 리포트 + 커밋 메시지 생성 + 커밋
```

### Human-in-the-Loop 확인 지점

파이프라인은 자동이지만, 핵심 지점에서 사용자 판단을 요청.

| 확인 지점 | 트리거 조건 | 사용자 선택지 |
|-----------|-------------|--------------|
| **리뷰 후 확인** | 항상 (이슈 0건이면 스킵) | `proceed` (전체 자동 수정) / `select` (이슈 선택 수정) / `skip` (수정 없이 커밋) / `abort` (중단) |
| **CRITICAL 이슈** | CRITICAL 등급 발견 시 | 파이프라인 즉시 중단, 사용자가 직접 판단 |
| **대규모 변경** | 10+ 파일 또는 삭제 포함 | 커밋 전 사용자 확인 |
| **Circuit Breaker** | 동일 에러 3회 반복 | 진단 보고서 제공, 사용자가 판단 |
| **검증 실패 2회** | Verify→Fix 루프 2회 실패 | 사용자에게 보고, 롤백 또는 수동 수정 |

**자동 모드 (`review.autoMode: true`)**: 이슈가 모두 HIGH/MEDIUM이고 신뢰도 80+ 이면 사용자 확인 없이 자동 진행. CRITICAL은 자동 모드에서도 항상 중단.

### 트리거 방식

| 방식 | 적용 단계 | 설명 |
|------|-----------|------|
| **자동 (Pre-Work A)** | Phase 1 | `UserPromptSubmit` 훅 — 경량 컨텍스트 주입만 |
| **수동 (Pre-Work B)** | Phase 1 | `/flow enhance` 스킬 — 풀 프롬프트 강화 |
| **자동 (Post-Work)** | Phase 2 | `Stop` 훅 — 작업 완료 후 파이프라인 실행 제안 |
| **수동 (Post-Work)** | Phase 2 | `/flow post` 스킬 — 명시적 실행 |
| **조건부** | Phase 2 | 특정 파일/디렉토리 변경 시에만 |

### 워크플로우 프리셋

변경 유형에 따라 최적의 파이프라인을 자동 선택. (ECC orchestrate 패턴)
**프리셋 판단은 `lib/orchestrator.mjs`에서 결정론적으로 수행** (LLM 판단에 의존하지 않음).

| 프리셋 | Post-Work 파이프라인 | 자동 감지 조건 |
|--------|---------------------|---------------|
| **feature** | review → confirm → fix → verify → commit | 기본값 |
| **bugfix** | review → confirm → fix → verify → commit | 변경 파일이 기존 코드 수정만 |
| **refactor** | review → confirm → verify → commit | 파일 구조 변경, import 변경 |
| **docs** | review → commit | `docs/**`, `*.md` 변경만 |
| **security** | review → confirm → fix → verify → commit | 인증/인가/암호화 관련 파일 |
| **custom** | config.json에서 직접 정의 | 사용자 설정 |

### 변경 규모에 따른 파이프라인 스케일링

| 변경 규모 | 기준 | 파이프라인 |
|-----------|------|-----------|
| **trivial** | 변경 3줄 이하 | review만 (요약 코멘트) |
| **small** | 변경 1~3 파일 | review → confirm → verify → commit |
| **normal** | 변경 4~10 파일 | 프리셋에 따른 풀 파이프라인 |
| **large** | 변경 10+ 파일 또는 삭제 포함 | 풀 파이프라인 + 커밋 전 사용자 확인 게이트 |

### 파이프라인은 모듈형
파이프라인은 **스테이지**의 조합. 프로젝트에 맞게 스테이지를 추가/제거/순서변경 가능.
Phase 1(Pre-Work)과 Phase 2(Post-Work)는 독립적으로 ON/OFF 가능.

```yaml
# Phase 1: Pre-Work
pre:
  autoContext: true     # (A) 훅 기반 자동 컨텍스트 보강
  enhance: true         # (B) /flow enhance 스킬 활성화

# Phase 2: Post-Work 파이프라인
post: [review, confirm, fix, verify, commit]

# 엄격 모드 (리뷰 2회)
post: [review, confirm, fix, verify, review, confirm, commit]

# 수동 수정 모드 (자동 수정 없이 리뷰+검증만)
post: [review, confirm, verify, commit]
```

## 프로젝트 구조 자동 감지

설치 후 첫 실행 시 프로젝트 환경을 자동 감지:

| 감지 항목 | 판별 방법 |
|-----------|-----------|
| **Git 구조** | bare repo + worktree / 일반 repo / non-git |
| **언어/프레임워크** | package.json, go.mod, Cargo.toml, pyproject.toml 등 |
| **패키지 매니저** | npm / yarn / pnpm / go / cargo / pip |
| **테스트 러너** | jest, vitest, pytest, go test 등 |
| **린터** | eslint, prettier, golangci-lint, ruff 등 |
| **빌드 도구** | tsc, webpack, vite, make 등 |
| **모노레포** | workspaces, packages/, apps/ 탐색 |
| **플랫폼** | github.com / bitbucket.org / gitlab.com |

감지 결과는 `.claude-workflow/config.json`에 캐싱, 수동 오버라이드 가능.
모노레포의 경우 변경된 패키지만 대상으로 파이프라인 실행.

## 스테이지 상세

### 0. Enhance (프롬프트 강화) — Phase 1

두 가지 모드로 동작한다.

#### (A) 자동 컨텍스트 보강 — 훅 기반

`UserPromptSubmit` 훅이 프롬프트를 분석하여 `system-reminder`로 컨텍스트를 주입.
프롬프트 자체는 변경하지 않는다. Claude가 더 많은 맥락을 알고 작업하게 하는 것.

**훅이 주입하는 컨텍스트:**
- 프로젝트 구조 요약 (언어, 프레임워크, 디렉토리 구조)
- 프롬프트에 언급된 파일/모듈의 관련 파일 목록
- `.claude/rules/`에 정의된 코딩 규칙
- 최근 변경 이력 요약 (최근 5커밋)

**제약 사항:**
- 타임아웃 3초 이내 (경량 처리만)
- 코드베이스 심층 탐색 불가
- 사용자 인터랙션 불가

#### (B) 명시적 프롬프트 강화 — 스킬 기반

`/flow enhance` 스킬로 인핸서 에이전트를 호출. 시간 제한 없이 코드베이스를 탐색하고 프롬프트를 구조화.

**강화 과정:**
```
1. 프롬프트 분석 — 의도, 범위, 대상 파일/모듈 파악
2. 코드베이스 탐색 — 관련 파일, 기존 패턴, 의존 관계 조사
3. 구조화 — 모호한 지시를 구체적인 단계로 분해
4. 제약 조건 추가 — 코딩 컨벤션, 기존 패턴, 프로젝트 규칙 반영
5. 확인 — 강화된 프롬프트를 사용자에게 보여주고 승인/수정 요청
```

**강화 유형:**

| 유형 | 원본 예시 | 강화 결과 |
|------|-----------|-----------|
| **모호함 해소** | "로그인 고쳐줘" | "src/auth/login.ts의 JWT 토큰 만료 처리 버그 수정. 현재 만료된 토큰으로 요청 시 500 에러 발생, 401로 변경 필요" |
| **범위 명확화** | "테스트 추가해줘" | "src/services/user.ts의 createUser, updateUser 함수에 대한 단위 테스트 추가. jest 사용, 기존 __tests__/ 패턴 따름" |
| **컨텍스트 보강** | "API 엔드포인트 만들어줘" | "src/routes/에 GET /api/users/:id 엔드포인트 추가. 기존 라우터 패턴(Express + Zod 검증) 따르고, UserService.findById 호출" |

**동작 모드:**

| 모드 | 설명 |
|------|------|
| **confirm** (기본) | 강화된 프롬프트를 보여주고 사용자 승인 후 실행 |
| **auto** | 자동 강화 후 바로 실행 (승인 단계 생략) |
| **suggest** | 강화 제안만 보여주고 사용자가 직접 수정/실행 |

### 1. Review (리뷰 허브) — Phase 2

변경 내용에 따라 **적절한 리뷰어 조합을 자동 선택**하여 병렬 실행 후 결과 합산.
리뷰어 선택은 `lib/orchestrator.mjs`가 결정론적으로 수행.

**입력:** SKILL.md가 Bash로 `git diff --cached`를 실행하여 결과를 에이전트에 전달
**출력:** 오케스트레이터가 에이전트 응답을 `.claude-workflow/state/review.json`에 기록
**Handoff:** `.claude-workflow/handoffs/review.md` — 결정/거부안/리스크 기록

#### 리뷰어 종류

**문서 리뷰어** — `docs/**`, `*.md`, `README`, `CHANGELOG` 변경 시

| 모델 | 체크 항목 |
|------|-----------|
| haiku | 문법, 오탈자, 일관성 |
| | 누락된 내용, 오래된 정보 |
| | 코드 예시와 실제 코드의 불일치 |
| | API 문서와 실제 인터페이스 정합성 |

**코드 리뷰어 — 프론트엔드** — `src/components/`, `*.tsx`, `*.css`, `*.vue` 등

| 모델 | 체크 항목 |
|------|-----------|
| sonnet | 컴포넌트 구조, 상태 관리 패턴 |
| | 접근성 (a11y), 키보드 내비게이션 |
| | 렌더링 성능 (불필요한 리렌더, 메모이제이션) |
| | 반응형 디자인, 크로스 브라우저 |

**코드 리뷰어 — 백엔드** — `src/api/`, `src/services/`, `src/routes/` 등

| 모델 | 체크 항목 |
|------|-----------|
| sonnet | API 설계 (RESTful, 에러 응답 형식) |
| | 에러 처리 (빈 catch, 미처리 Promise) |
| | DB 쿼리 (N+1, 트랜잭션, 커넥션 관리) |
| | 비즈니스 로직 정합성 |

**코드 리뷰어 — DA/데이터** — `migrations/`, `*.sql`, `schema.*`, `prisma/` 등

| 모델 | 체크 항목 |
|------|-----------|
| sonnet | 스키마 설계 (정규화, 관계, 타입) |
| | 쿼리 최적화 (인덱싱, 실행 계획) |
| | 마이그레이션 안전성 (롤백 가능, 다운타임) |
| | 데이터 무결성 제약 조건 |

**보안 리뷰어** — 인증/인가/암호화 관련 파일 또는 `security` 프리셋 시 항상

| 모델 | 체크 항목 |
|------|-----------|
| sonnet | OWASP Top 10 (인젝션, XSS, CSRF 등) |
| | 하드코딩된 시크릿, API 키 노출 |
| | 입력 검증, 출력 인코딩 |
| | 접근 제어, 인가 로직 |
| | 암호화 패턴 (해싱, 토큰 관리) |

#### 리뷰어 자동 선택 로직

`lib/orchestrator.mjs`가 변경된 파일 경로를 분석하여 결정론적으로 리뷰어를 선택:

```
docs/**, *.md           → 문서 리뷰어 활성화
*.tsx, *.vue, *.css     → 프론트엔드 리뷰어 활성화
src/api/**, routes/**   → 백엔드 리뷰어 활성화
migrations/**, *.sql    → DA 리뷰어 활성화
auth/**, crypto/**      → 보안 리뷰어 활성화
여러 영역에 걸침         → 해당하는 리뷰어 모두 병렬 실행
판단 불가                → 백엔드 리뷰어 (기본값)
```

config.json의 `review.reviewerMapping`으로 경로-리뷰어 매핑 커스터마이즈 가능.
trivial 변경(3줄 이하)은 리뷰어 1개만 실행 (sonnet, 통합 리뷰).

#### 리뷰어별 검증 기준 문서

각 리뷰어는 **"무엇이 이슈이고 무엇이 아닌지"를 판단하는 기준 문서**를 참조.

**2단계 기준 참조:**
1. **프로젝트 기준** (우선) — `.claude-workflow/standards/`에 있으면 이것을 따름
2. **플러그인 내장 기준** (기본값) — 프로젝트 기준이 없으면 플러그인 내장 기준 적용

**프로젝트 기준 문서 구조:**
```
.claude-workflow/standards/
├── docs.md          ← 문서 리뷰 기준
├── frontend.md      ← 프론트엔드 기준
├── backend.md       ← 백엔드 기준
├── data.md          ← DA/데이터 기준
└── security.md      ← 보안 기준
```

프로젝트 기준이 존재하면 내장 기준을 완전히 대체 (merge가 아닌 override).

리뷰어는 이슈 보고 시 **어떤 기준을 근거로 판단했는지** 출력에 포함:
```json
{
  "file": "src/api/users.ts",
  "line": 42,
  "severity": "HIGH",
  "confidence": 92,
  "message": "루프 내 DB 쿼리 (N+1)",
  "standardRef": "backend.md#db-쿼리",
  "suggestedFix": "Promise.all + batch query로 변경"
}
```

#### 리뷰어 공통 규칙

**리뷰 기준 적용 순서:**
1. 프로젝트 기준 (`.claude-workflow/standards/*.md`) — 있으면 우선
2. 플러그인 내장 기준 (`standards/*.md`) — 없으면 기본값
3. `.claude/rules/` — 추가 규칙으로 보충

**거짓 양성 필터링** (공식 code-review 패턴):
- 기존에 이미 있던 이슈 (이번 변경이 도입하지 않은 것)
- 린터/타입체커가 잡을 이슈 (Verify 스테이지에서 처리)
- 의도적인 기능 변경

**이슈 분류 + 신뢰도 점수:**

| 등급 | 의미 | 처리 |
|------|------|------|
| CRITICAL | 보안 취약점, 데이터 손실 위험 | 파이프라인 즉시 중단, 사용자 확인 |
| HIGH | 버그, 타입 오류 | 사용자 확인 후 자동 수정 |
| MEDIUM | 코드 스멜, 경미한 이슈 | 사용자 확인 후 자동 수정 |
| LOW | 스타일, 제안 사항 | 커밋 메시지에 메모만 |

각 이슈에 0-100 신뢰도 점수 부여. **80 미만은 자동 필터링** (공식 code-review 패턴).

**리뷰어 결과 중복 해결:** 여러 리뷰어가 같은 파일/라인에 이슈를 보고하면 더 높은 severity를 채택하고 하나로 합산.

**출력 스키마:**
```json
{
  "issues": [
    {
      "file": "src/auth/login.ts",
      "line": 42,
      "severity": "HIGH",
      "confidence": 92,
      "category": "에러 처리",
      "message": "catch 블록에서 에러를 무시하고 있음",
      "suggestedFix": "에러 로깅 추가 또는 상위로 전파",
      "standardRef": "backend.md#에러-처리",
      "source": "backend-reviewer"
    }
  ],
  "summary": { "critical": 0, "high": 2, "medium": 1, "low": 3 },
  "activeReviewers": ["backend-reviewer", "security-reviewer"],
  "filteredCount": 5
}
```

### 1.5. Confirm (사용자 확인) — Phase 2

리뷰 결과를 사용자에게 보고하고 진행 방식을 결정받는다.

**입력:** `.claude-workflow/state/review.json`
**출력:** 사용자 선택 (proceed / select / skip / abort)

**사용자에게 표시:**
```
## 리뷰 결과 요약
- 활성화된 리뷰어: 백엔드, 보안
- 발견된 이슈: HIGH 2건, MEDIUM 1건, LOW 3건
- 필터링된 이슈: 5건 (신뢰도 80 미만)

### HIGH 이슈
1. [src/auth/login.ts:42] catch 블록에서 에러 무시 (confidence: 92)
2. [src/api/users.ts:15] N+1 쿼리 (confidence: 88)

### MEDIUM 이슈
1. [src/utils/date.ts:7] 매직 넘버 사용 (confidence: 85)

어떻게 진행할까요?
- proceed: 모든 HIGH/MEDIUM 이슈 자동 수정
- select: 수정할 이슈 선택
- skip: 수정 없이 검증+커밋 진행
- abort: 파이프라인 중단
```

**이슈 0건일 경우:** confirm 스킵, 바로 Verify → Commit 진행.

### 2. Fix (수정) — Phase 2

사용자가 승인한 이슈를 자동 수정.

**입력:** `.claude-workflow/state/review.json` + 사용자 선택
**출력:** 오케스트레이터가 `.claude-workflow/state/fix.json`에 기록
**Handoff:** `.claude-workflow/handoffs/fix.md`

**수정 루프:**
```
라운드 1: 이슈 수정 → 재리뷰 → 잔여 이슈 확인
라운드 2: 잔여 이슈 수정 → 재리뷰
라운드 3: 최종 확인 → 미해결 이슈 보고
최대 3라운드. 3라운드 후에도 미해결이면 사용자에게 보고.
```

**Circuit Breaker** (OMC ralph 패턴):
- 동일 에러가 3회 연속 발생하면 즉시 중단
- "진단 보고서" 생성 모드로 전환 (수정 시도 X, 근본 원인 분석만)
- 사용자에게 진단 결과 보고

### 3. Verify (검증) — Phase 2

프로젝트 감지 결과를 기반으로 **결정론적 도구만** 실행. 에이전트 판단 없이 도구 실행 결과(pass/fail)로만 판정.

**입력:** `.claude-workflow/state/fix.json`
**출력:** `.claude-workflow/state/verify.json`

```
1. 린트 (eslint, prettier, ruff 등)
2. 타입 체크 (tsc --noEmit, mypy 등)
3. 빌드 (감지된 빌드 명령)
4. 테스트 (변경된 파일 관련 테스트만 우선 실행)
```

실패 시 → Fix 스테이지로 돌아가서 수정 시도.
**Verify→Fix 루프 최대 2회.** 2회 후에도 실패하면 파이프라인 중단 + 사용자 보고.

### 4. Commit (커밋) — Phase 2

변경 내용을 분석하여 커밋 메시지 자동 생성 + 변경 요약 리포트.

**입력:** `.claude-workflow/state/verify.json` + 전체 diff
**출력:** 커밋 완료 + `.claude-workflow/state/commit.json`

**변경 요약 리포트** (이해 부채 방지):
- 무엇이 변경되었는지 (파일별 요약)
- 왜 변경되었는지 (리뷰 이슈 → 수정 매핑)
- 파이프라인이 자동으로 수정한 항목 목록
- 사용자에게 출력하여 변경 사항을 이해할 수 있게 함

**커밋 메시지 규칙:**
- Conventional Commits 형식 (feat/fix/docs/refactor/test/chore)
- 프로젝트에 기존 커밋 스타일이 있으면 그걸 따름
- 변경 범위가 크면 커밋 분할 여부를 사용자에게 질문 (auto 모드에서는 단일 커밋)

**커밋 후 자동 흐름:**
```
[커밋] 자동
    ↓
[Push] 자동 (autoPush: true)
    ↓
[PR 본문 생성] 리뷰 결과 + 변경 요약 + 검증 결과로 PR body 작성
    ↓
[사용자 확인] "이 내용으로 PR 생성할까요?" → 승인/수정/취소
    ↓
[PR 생성] gh/glab/bitbucket (플랫폼 자동 감지)
```

## 상태 전달

### 설계 원칙
- **에이전트는 상태 파일을 직접 쓰지 않는다.** 에이전트는 구조화된 응답을 반환하고, SKILL.md(오케스트레이터)가 응답을 파싱하여 state/*.json에 기록.
- 이렇게 하면 리뷰어에 Write 도구를 줄 필요가 없고, 스키마 검증도 오케스트레이터에서 일괄 수행 가능.

### 상태 파일 (구조화된 데이터)

```
.claude-workflow/state/
├── run-{timestamp}.json     ← 현재 파이프라인 실행 메타데이터
├── review.json              ← 리뷰 결과 (이슈 목록)
├── fix.json                 ← 수정 결과 (수정/미수정 이슈)
├── verify.json              ← 검증 결과 (린트/빌드/테스트 성공 여부)
└── commit.json              ← 커밋 결과 (커밋 해시, 변경 요약)
```

### Handoff 문서 (맥락 전달)

```
.claude-workflow/handoffs/
├── review.md                ← 리뷰어의 결정 근거, 거짓 양성 제외 이유, 리스크 판단
├── fix.md                   ← 수정 전략, 시도한 접근법, 실패한 접근법
└── verify.md                ← 실패한 검증 항목의 원인 분석
```

Handoff 문서는 "다음 에이전트가 동일한 실수를 반복하지 않도록" 결정/거부안/리스크를 기록.
컨텍스트 컴팩션이 발생해도 Handoff 파일로 맥락이 보존됨.

### 이전 산출물 존재 시 스킵 (Resume)

파이프라인 중단 후 재개 시, 각 스테이지의 output 파일 존재 여부를 확인하여 완료된 스테이지를 건너뜀.

## 롤백 메커니즘

Phase 2 시작 전 자동으로 롤백 지점을 생성:

```
[파이프라인 시작]
    ↓
git stash push -m "workflow-plugin-checkpoint-{timestamp}"
    또는
git checkout -b workflow-backup-{timestamp}
    ↓
[파이프라인 실행]
    ↓
[성공 시] 체크포인트 삭제
[실패 시] git stash pop 또는 git checkout으로 원복
```

`/flow rollback` — 마지막 파이프라인 실행 전 상태로 복원.

## 관측 가능성

### 실행 로그

```
.claude-workflow/logs/
├── {timestamp}-run.json     ← 파이프라인 실행 전체 기록
```

**기록 항목:**
- 각 스테이지 시작/종료 시간
- 에이전트별 모델 및 토큰 사용량
- 발견된 이슈 수, 수정된 이슈 수
- 검증 pass/fail 결과
- 사용자 확인 지점에서의 선택
- 파이프라인 성공/실패/중단 여부

`/flow status` — 현재 실행 상태 + 최근 실행 히스토리 요약.

## 자기개선 (Pattern Learning)

파이프라인 실행마다 **"어떤 이슈가 반복되는가" + "사용자가 어떻게 반응했는가"**를 추적.
반복 검증된 패턴만 리뷰 기준에 반영. 자동 반영이 아닌 **사용자 승인 후 반영**.

### 학습 흐름

```
[파이프라인 실행]
    ↓
[리뷰어 이슈 발견]
    ↓
[사용자 선택] proceed / skip / abort
    ↓ (이 선택이 핵심 학습 데이터)
[패턴 수집기]
    - 이슈 카테고리 + 파일 패턴
    - 사용자 반응: accepted / rejected / fixed
    ↓
[패턴 저장소] .claude-workflow/patterns.json
    ↓
[주기적 정리] 30일 미발견 패턴 자동 삭제
    ↓
[기준 반영] /flow learn → 사용자 승인 후 learned.md에 추가
```

### 패턴 저장소 스키마

```json
{
  "empty-catch": {
    "category": "에러 처리",
    "filePattern": "src/**/*.ts",
    "occurrences": 7,
    "accepted": 5,
    "rejected": 2,
    "fixSuccess": 4,
    "fixFailed": 1,
    "confidence": 0.71,
    "status": "suggest",
    "firstSeen": "2026-04-06",
    "lastSeen": "2026-04-07",
    "example": "src/api/users.ts:42 — catch 블록에서 에러 무시"
  }
}
```

### Confidence 계산

```
confidence = (accepted / occurrences) × (fixSuccess / max(accepted, 1))
```

- `accepted / occurrences` — 사용자가 이 이슈를 실제 문제로 인정한 비율
- `fixSuccess / accepted` — 수정이 실제로 성공한 비율
- 둘 다 높아야 confidence가 올라감

### 3단계 성숙도

| 단계 | confidence | 동작 |
|------|-----------|------|
| **관찰** | 0.0 ~ 0.6 | 패턴만 기록, 리뷰에 영향 없음 |
| **제안** | 0.6 ~ 0.9 | 리뷰 시 "이전에도 발견된 패턴입니다" 표시 |
| **기준 후보** | 0.9+ | `/flow learn`에서 기준 추가 후보로 제시 |

**자동으로 기준에 반영되지 않음.** 반드시 `/flow learn`에서 사용자가 확인하고 승인해야 `learned.md`에 추가.

### `/flow learn` 스킬

```
/flow learn 실행 시:
  1. patterns.json에서 confidence 0.9+ 패턴 목록 제시
  2. 각 패턴의 발견 횟수, 승인률, 수정 성공률 표시
  3. 사용자가 선택: approve (기준 추가) / reject (패턴 삭제) / skip (보류)
  4. 승인된 패턴 → .claude-workflow/standards/learned.md에 추가
  5. 거부된 패턴 → patterns.json에서 삭제
```

### 학습 데이터 수집 지점

| 지점 | 수집 데이터 |
|------|-----------|
| Review 완료 후 | 이슈 카테고리, 파일 패턴, severity, confidence |
| Confirm 사용자 선택 | accepted (proceed/select) vs rejected (skip) |
| Fix 완료 후 | fixSuccess (수정 성공) vs fixFailed (동일 에러 재발) |
| `/flow learn` | 사용자의 최종 승인/거부 |

### 정리 규칙

- **30일 미발견**: 패턴 자동 삭제 (프로젝트가 개선되어 더 이상 발생하지 않는 이슈)
- **confidence 0.3 미만 + 5회 이상 발견**: 거짓 양성으로 판단, 자동 삭제
- **patterns.json 최대 100개**: 오래된 낮은 confidence 패턴부터 삭제

### learned.md 형식

```markdown
# Learned Review Standards

> 이 파일은 /flow learn에서 승인된 패턴으로 자동 생성됩니다.
> 수동 편집 가능. 삭제하면 해당 기준이 제거됩니다.

## 에러 처리
- catch 블록에서 에러를 무시하지 않는다. 최소한 logger.error() 필수.
  (근거: 7회 발견, 승인률 71%, 수정 성공률 80%)

## DB 쿼리
- 루프 내 DB 쿼리 금지. batch/join 사용.
  (근거: 4회 발견, 승인률 100%, 수정 성공률 100%)
```

리뷰어는 기존 기준 참조 순서에 learned.md를 추가:
1. 프로젝트 기준 (`.claude-workflow/standards/*.md`)
2. **학습된 기준 (`.claude-workflow/standards/learned.md`)**
3. 플러그인 내장 기준 (`standards/*.md`)

## 에이전트

### 에이전트 목록

| 에이전트 | 모델 | 단계 | 사용 스테이지 | 활성화 조건 |
|----------|------|------|---------------|-------------|
| **인핸서** | sonnet | Phase 1 | Enhance (B) | `/flow enhance` 호출 시 |
| **문서 리뷰어** | haiku | Phase 2 | Review | `docs/**`, `*.md` 변경 시 |
| **프론트엔드 리뷰어** | sonnet | Phase 2 | Review | `*.tsx`, `*.vue`, `*.css` 변경 시 |
| **백엔드 리뷰어** | sonnet | Phase 2 | Review | `src/api/**`, `routes/**` 변경 시 (기본값) |
| **DA 리뷰어** | sonnet | Phase 2 | Review | `migrations/**`, `*.sql` 변경 시 |
| **보안 리뷰어** | sonnet | Phase 2 | Review | 인증/인가 관련 또는 security 프리셋 |
| **픽서** | sonnet | Phase 2 | Fix | 사용자가 수정 승인 시 |
| **검증자** | haiku | Phase 2 | Verify | 항상 |
| **커미터** | haiku | Phase 2 | Commit | 항상 |

검증자와 커미터는 haiku — 도구 실행 결과 판단/커밋 메시지 생성은 경량 작업.
리뷰어는 변경 파일에 따라 필요한 것만 활성화 — 불필요한 리뷰어를 돌리지 않음.

### 에이전트 권한 제한 (tools 허용 목록)

Claude Code 에이전트 프론트매터에서는 `tools:` 필드로 허용 도구만 명시.
목록에 없는 도구는 자동으로 차단된다.

```yaml
# enhancer.md — 읽기 + 탐색만
tools: [Glob, Grep, Read, WebFetch, WebSearch]

# reviewer-*.md (전 리뷰어 공통) — 읽기 + 분석만
tools: [Glob, Grep, Read]

# fixer.md — 읽기 + 쓰기 (수정 전담)
tools: [Glob, Grep, Read, Write, Edit, Bash]

# verifier.md — 도구 실행만 (코드 수정 불가)
tools: [Glob, Grep, Read, Bash]

# committer.md — 도구 실행만 (프롬프트에서 git 명령만 사용하도록 지시)
tools: [Glob, Grep, Read, Bash]
```

**참고:** `Bash(git:*)` 같은 세분화된 Bash 제한은 skill/command 전용 문법이므로 에이전트에서는 사용 불가. 커미터의 git-only 제약은 프롬프트 지시로 강제하고, tools에는 Bash를 허용.

### 에이전트 Failure Modes (각 에이전트에 명시)

모든 에이전트 마크다운에 "이 함정에 빠지지 말 것" 섹션 포함.

**리뷰어 Failure Modes:**
- "Compiles-therefore-correct": 빌드 성공 ≠ 올바른 코드
- "이미 있던 이슈 보고": 이번 변경이 도입하지 않은 기존 이슈를 보고
- "린터가 잡을 것 보고": Verify 스테이지에서 처리할 이슈를 중복 보고

**픽서 Failure Modes:**
- "과도한 리팩토링": 이슈 수정 범위를 넘어선 코드 변경
- "테스트 삭제로 우회": 실패하는 테스트를 삭제하여 통과시킴
- "추상화 비대": 100줄이면 될 것을 1,000줄로 작성

**검증자 Failure Modes:**
- "Stale evidence": 이전 실행 결과가 아닌 fresh output으로 판단
- "Trust without evidence": 주관적 "아마 괜찮을 것" 금지

파이프라인 오케스트레이션은 `/flow` 스킬이 담당 (에이전트가 아님).
에이전트는 독립적이므로, 파이프라인 외에서도 개별 호출 가능.

## 스킬

| 스킬 | 단계 | 설명 |
|------|------|------|
| `/flow` | 전체 | 파이프라인 수동 실행 (Phase 1B + 2) |
| `/flow enhance` | Phase 1 | 프롬프트 강화만 실행 (인핸서 에이전트 호출) |
| `/flow review` | Phase 2 | 리뷰 스테이지만 실행 |
| `/flow fix` | Phase 2 | 수정 스테이지만 실행 |
| `/flow verify` | Phase 2 | 검증 스테이지만 실행 |
| `/flow commit` | Phase 2 | 커밋 스테이지만 실행 |
| `/flow post` | Phase 2 | Post-Work 파이프라인 전체 실행 |
| `/flow rollback` | — | 마지막 파이프라인 실행 전 상태로 복원 |
| `/flow status` | — | 현재 파이프라인 진행 상태 + 최근 실행 히스토리 |
| `/flow config` | — | 설정 대화형 수정 |
| `/flow learn` | — | 학습된 패턴 검토 → 승인/거부 → learned.md 반영 |

### `/flow` 오케스트레이션 구조

**결정론적 로직 (lib/orchestrator.mjs):**
- 변경 규모 판단 (git diff --stat 파싱)
- 프리셋 자동 선택 (파일 경로 패턴 매칭)
- 리뷰어 자동 선택 (config.json의 reviewerMapping)
- 리뷰어 결과 중복 해결 (같은 파일/라인 → 높은 severity 채택)
- state/*.json 스키마 검증

**LLM 오케스트레이션 (skills/flow/SKILL.md):**
- orchestrator.mjs 결과를 읽어 에이전트 호출 결정
- 에이전트를 서브에이전트로 순차/병렬 호출
- 에이전트 응답을 받아 state/*.json + handoffs/*.md에 기록
- 사용자 확인 지점에서 선택지 제시 및 응답 처리
- CRITICAL / Circuit Breaker / 검증 실패 시 중단 + 보고

## 훅 연결

```json
{
  "hooks": {
    "UserPromptSubmit": [{
      "matcher": "*",
      "hooks": [
        { "type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/lib/context-injector.mjs", "timeout": 3 }
      ]
    }],
    "Stop": [{
      "matcher": "*",
      "hooks": [
        { "type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/lib/stop-checker.mjs", "timeout": 3 }
      ]
    }],
    "PreToolUse": [{
      "matcher": "Bash",
      "hooks": [
        { "type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/lib/commit-guard.mjs", "timeout": 3 }
      ]
    }],
    "SubagentStop": [{
      "matcher": "*",
      "hooks": [
        { "type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/lib/verify-deliverables.mjs", "timeout": 3 }
      ]
    }],
    "SessionStart": [{
      "matcher": "*",
      "hooks": [
        { "type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/lib/session-init.mjs", "timeout": 5 }
      ]
    }]
  }
}
```

| 훅 | 역할 |
|-----|------|
| `context-injector.mjs` | Phase 1A: 프롬프트에서 키워드/파일 감지 → system-reminder로 컨텍스트 주입 |
| `stop-checker.mjs` | Phase 2 트리거: 파일 변경 여부 확인 → 변경 있으면 파이프라인 실행 제안 |
| `commit-guard.mjs` | git commit 직전: 스크립트 내부에서 `tool_input.command`가 `git commit`인지 확인 → 리뷰 미실행 시 경고 |
| `verify-deliverables.mjs` | 서브에이전트 종료 시: 산출물(state/*.json) 존재/유효성 자동 검증 |
| `session-init.mjs` | 세션 시작: 미커밋 변경 감지 → 파이프라인 실행 제안, config 로드 |

**참고:** `PreToolUse`의 matcher는 `"Bash"`로 설정하고, `commit-guard.mjs` 스크립트 내부에서 `tool_input.command`를 파싱하여 `git commit` 명령인지 확인. (hooks matcher는 도구명 수준만 지원)

**중요**: Phase 1 자동 컨텍스트 보강, Phase 2 자동 트리거 모두 기본 OFF.
사용자가 `/flow config`에서 명시적으로 켜야 동작.
수동 `/flow`, `/flow enhance`, `/flow post`는 항상 사용 가능.

## 설정 파일

### .claude-workflow/config.json

```json
{
  "project": {
    "type": "git-repo",
    "language": "typescript",
    "packageManager": "yarn",
    "testRunner": "jest",
    "linter": "eslint",
    "buildCommand": "yarn build",
    "testCommand": "yarn test",
    "platform": "github",
    "baseBranch": "main"
  },
  "pipeline": {
    "pre": {
      "autoContext": false,
      "enhance": true
    },
    "post": ["review", "confirm", "fix", "verify", "commit"],
    "preset": "auto",
    "scaling": {
      "trivialThreshold": 3,
      "largeThreshold": 10
    },
    "overrides": {
      "docs/**/*": { "preset": "docs" },
      "src/auth/**/*": { "preset": "security" }
    }
  },
  "enhance": {
    "mode": "confirm",
    "injectProjectStructure": true,
    "injectRules": true,
    "injectRecentChanges": 5
  },
  "trigger": {
    "autoPostWork": false,
    "ignorePatterns": ["*.lock", "node_modules/**", "dist/**"]
  },
  "review": {
    "parallelReviewers": true,
    "confidenceThreshold": 80,
    "autoMode": true,
    "maxFixRounds": 3,
    "maxVerifyRetries": 2,
    "circuitBreakerThreshold": 3,
    "autoFixSeverity": ["HIGH", "MEDIUM"],
    "blockSeverity": ["CRITICAL"],
    "reportSeverity": ["LOW"],
    "reviewerMapping": {
      "docs/**/*": "docs",
      "*.md": "docs",
      "src/components/**/*": "frontend",
      "*.tsx": "frontend",
      "*.vue": "frontend",
      "*.css": "frontend",
      "src/api/**/*": "backend",
      "src/services/**/*": "backend",
      "src/routes/**/*": "backend",
      "migrations/**/*": "data",
      "*.sql": "data",
      "prisma/**/*": "data",
      "src/auth/**/*": "security",
      "src/crypto/**/*": "security"
    },
    "defaultReviewer": "backend"
  },
  "commit": {
    "style": "conventional",
    "generateSummaryReport": true,
    "autoPush": true,
    "autoCreatePR": "confirm"
  },
  "rollback": {
    "strategy": "stash",
    "autoCleanup": true
  }
}
```

## 플러그인 구조

```
workflow-plugin/
├── .claude-plugin/
│   └── plugin.json              ← 플러그인 매니페스트 (name, agents, skills만)
├── agents/
│   ├── enhancer.md              ← 프롬프트 강화 에이전트 (Phase 1B)
│   ├── reviewer-docs.md         ← 문서 리뷰어 (haiku)
│   ├── reviewer-frontend.md     ← 프론트엔드 코드 리뷰어 (sonnet)
│   ├── reviewer-backend.md      ← 백엔드 코드 리뷰어 (sonnet)
│   ├── reviewer-data.md         ← DA/데이터 리뷰어 (sonnet)
│   ├── reviewer-security.md     ← 보안 리뷰어 (sonnet)
│   ├── fixer.md                 ← 픽서 에이전트 (sonnet)
│   ├── verifier.md              ← 검증자 에이전트 (haiku)
│   └── committer.md             ← 커미터 에이전트 (haiku)
├── skills/
│   └── flow/
│       └── SKILL.md             ← /flow 스킬 (LLM 오케스트레이션)
├── hooks/
│   └── hooks.json               ← 훅 정의
├── lib/
│   ├── orchestrator.mjs         ← 결정론적 로직 (프리셋/스케일링/리뷰어 선택)
│   ├── state-manager.mjs        ← 상태 파일 읽기/쓰기/검증
│   ├── schemas.mjs              ← state/*.json 스키마 정의
│   ├── detect-project.mjs       ← 프로젝트 구조 감지
│   ├── context-injector.mjs     ← Phase 1A 컨텍스트 주입
│   ├── stop-checker.mjs         ← Phase 2 변경 감지
│   ├── commit-guard.mjs         ← git commit 전 리뷰 확인
│   ├── verify-deliverables.mjs  ← 서브에이전트 산출물 검증
│   ├── session-init.mjs         ← 세션 초기화
│   ├── rollback.mjs             ← 롤백 체크포인트 관리
│   ├── logger.mjs               ← 실행 로그 기록
│   └── pattern-tracker.mjs      ← 패턴 학습 (자기개선)
├── standards/
│   ├── docs.md                  ← 문서 리뷰 내장 기준
│   ├── frontend.md              ← 프론트엔드 리뷰 내장 기준
│   ├── backend.md               ← 백엔드 리뷰 내장 기준
│   ├── data.md                  ← DA/데이터 리뷰 내장 기준
│   └── security.md              ← 보안 리뷰 내장 기준
├── templates/
│   ├── review-report.md         ← 리뷰 리포트 템플릿
│   ├── summary-report.md        ← 변경 요약 리포트 템플릿
│   └── pr-body.md               ← PR 본문 템플릿
├── .gitignore                   ← 런타임 파일 제외
└── README.md                    ← 플러그인 사용 가이드
```

## 확장 포인트

플러그인은 핵심 파이프라인 프레임워크만 제공.
추가 워크플로우는 **커스텀 스테이지**로 확장:

```
# 사용자가 커스텀 스테이지 추가 예시
.claude-workflow/stages/
├── doc-gen.md          ← "변경된 코드에 대한 문서 자동 생성"
├── changelog.md        ← "CHANGELOG 자동 업데이트"
└── notify.md           ← "Slack 알림 전송"

# config.json에서 사용
"pipeline": {
  "post": ["review", "confirm", "fix", "verify", "doc-gen", "changelog", "commit", "notify"]
}
```

**커스텀 스테이지 인터페이스:**
```yaml
---
name: doc-gen
description: 변경된 코드에 대한 문서 자동 생성
model: sonnet
tools: [Glob, Grep, Read, Write, Edit]
inputs: [changed-files, review-report]
outputs: [doc-gen-result]
onFailure: skip                          # skip | abort | ask
---

## Failure Modes
- ...

## Instructions
- ...
```

## 구현 순서

1. 플러그인 스캐폴딩 + plugin.json + .gitignore + README.md
2. 프로젝트 구조 자동 감지 (`detect-project.mjs`)
3. 상태 전달 프로토콜 정의 (`state-manager.mjs` + `schemas.mjs`)
4. 결정론적 오케스트레이터 (`orchestrator.mjs` — 프리셋/스케일링/리뷰어 선택)
5. `/flow` 스킬 + LLM 오케스트레이션 (`SKILL.md` — 에이전트 호출, 사용자 확인, 중단/재개)
6. Phase 1A: 컨텍스트 주입 훅 (`context-injector.mjs`)
7. Phase 1B: 인핸서 에이전트 (`enhancer.md`)
8. 리뷰어 에이전트 × 5 (문서/프론트/백엔드/DA/보안) + standards × 5
9. 픽서 에이전트 (`fixer.md` + 수정 루프 + circuit breaker)
10. 검증자 에이전트 (`verifier.md` + Verify→Fix 루프)
11. 커미터 에이전트 (`committer.md` + 변경 요약 리포트 + 템플릿)
12. 훅 등록 (hooks.json + stop-checker, commit-guard, verify-deliverables, session-init)
13. 관측 가능성 (`logger.mjs` + `/flow status`)
14. 롤백 메커니즘 (`rollback.mjs` + `/flow rollback`)
15. 커스텀 스테이지 로딩
16. 통합 테스트 (다양한 프로젝트 타입에서 검증)

### MVP 범위

Step 1 + 2 + 3 + 4 + 5 + 8(백엔드 리뷰어만) + 9(최소 픽서) + 10 + 11

MVP로 달성되는 것:
- `/flow post` → 리뷰 → **사용자 확인** → 수정 → 검증 → 커밋
- 사용자가 리뷰 결과를 보고 proceed/select/skip/abort 선택 가능
- 최소 픽서로 승인된 이슈 자동 수정
- 백엔드 리뷰어 + 내장 기준으로 기본 리뷰
