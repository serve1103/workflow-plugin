# Git Workflow Agent Plugin — 프로젝트 프롬프트

## 목표
Claude Code 플러그인으로, 훅 기반 에이전트 오케스트레이션을 통해 Git 워크플로우를 자동화한다.
어떤 프로젝트에서든 `claude plugin install`로 설치하면 즉시 동작하는 범용 플러그인.

## 핵심 컨셉

### 프로젝트 구조 자동 감지
플러그인 설치 후 첫 실행 시 프로젝트 구조를 자동 감지하여 동작 방식을 결정:
- **bare repo + worktree**: 워크트리 기반 브랜치 분리, dev/main 이중 브랜치 전략
- **일반 git repo**: 브랜치 기반 단순 워크플로우
- **모노레포**: packages/apps 자동 탐색, 영역별 린트/빌드/테스트

감지 결과는 `.claude-workflow/config.json`에 캐싱, 사용자가 수동 오버라이드 가능.

### 역할 기반 에이전트

| 에이전트 | 역할 | 트리거 (훅) |
|----------|------|-------------|
| **세션 매니저** | 환경 파악, 미커밋 변경 감지, 작업 현황 추적 | 세션 시작 시 자동 |
| **플래너** | 계획 문서 분석 → TODO 추출 → 작업 분배, 진행률 추적 | `/plan-work` 스킬 또는 계획 문서 변경 감지 |
| **환경 매니저** | 워크트리/브랜치 생성, 의존성 설치, 정리 | `/worktree` 스킬 또는 새 작업 시작 시 |
| **코드 리뷰어** | 변경 사항 리뷰, 이슈 분류(CRITICAL~LOW), 자동 수정 | 커밋 전 훅, `/review` 스킬 |
| **시퍼** | 커밋→푸시→PR→머지→동기화→정리 | `/ship` 스킬, 또는 모든 TODO 완료 감지 시 제안 |

### 훅 기반 동적 트리거

```
SessionStart     → 세션 매니저: 환경 파악 + 작업 현황 표시
PreCommit        → 코드 리뷰어: 변경 사항 자동 리뷰 (CRITICAL~MEDIUM 이슈 있으면 커밋 차단)
PostCommit       → 세션 매니저: TODO 갱신 + "다음 작업" 제안
FileChange       → 플래너: active-todo.md 변경 시 진행률 재계산
PrePush          → 코드 리뷰어: 최종 리뷰 (push 전 마지막 검증)
```

훅은 `.claude/settings.json`의 hooks 섹션에 자동 등록.
사용자가 원하지 않는 훅은 설정에서 비활성화 가능.

## 스킬 목록

| 스킬 | 설명 | 에이전트 |
|------|------|----------|
| `/start` | 세션 시작 — 환경/작업 현황 파악 | 세션 매니저 |
| `/status` | 현재 진행률 + 다음 작업 제안 | 세션 매니저 |
| `/plan-work <문서>` | 계획 문서 → TODO → 워크트리 → 순차 실행 | 플래너 |
| `/worktree <브랜치명>` | 작업 환경 생성 (워크트리 or 브랜치) | 환경 매니저 |
| `/review` | 수동 코드 리뷰 트리거 | 코드 리뷰어 |
| `/ship [커밋메시지]` | 커밋→리뷰→푸시→PR→머지→정리 | 시퍼 |

## 프로젝트 구조별 동작 차이

### bare repo + worktree (예: Anchor-wt)
```
/worktree feat/xxx
  → git worktree add ../feat-xxx -b feat/xxx dev
  → 의존성 설치 (감지된 package.json 위치 기준)

/ship
  → 커밋 → 리뷰 루프 → 푸시 → PR (대상: dev)
  → 머지 → main 워크트리에서 git pull
  → 워크트리 정리 (node_modules 삭제 → worktree remove → branch delete)
```

### 일반 git repo (예: Tallia)
```
/worktree feat/xxx
  → git checkout -b feat/xxx (워크트리 대신 브랜치 생성)
  → 의존성 설치

/ship  
  → 커밋 → 리뷰 루프 → 푸시 → PR (대상: main)
  → 머지 → git checkout main → git pull
  → 브랜치 삭제
```

### 모노레포
```
의존성 설치: 루트 package.json 감지 → npm/yarn/pnpm workspaces 자동 판별
리뷰: 변경된 패키지만 대상으로 린트/빌드/테스트
```

## 플랫폼 감지 (PR/머지)
- `*github.com*` → `gh` CLI
- `*bitbucket.org*` → Bitbucket API
- `*gitlab.com*` → `glab` CLI
- 감지 실패 시 → 사용자에게 선택 요청

## 코드 리뷰어 상세

### 리뷰 기준
1. 프로젝트의 `.claude/rules/` 파일이 있으면 참조
2. 없으면 기본 리뷰 체크리스트 적용:
   - 보안 (하드코딩된 시크릿, SQL 인젝션, XSS 등)
   - 타입 안전성
   - 에러 처리
   - 성능 (N+1, 불필요한 루프 등)

### 리뷰-수정 반복 루프
```
라운드 1: 리뷰 → 이슈 분류 → CRITICAL~MEDIUM 자동 수정 → 검증
라운드 2: 재리뷰 → 잔여 이슈 확인 → 수정 → 검증
라운드 3: 최종 리뷰 → 잔여 이슈 보고 → 사용자 확인
최대 3라운드, LOW는 PR 본문에 메모만
```

## 설정 파일

### .claude-workflow/config.json (자동 생성, 사용자 오버라이드 가능)
```json
{
  "projectType": "normal",       // "bare-worktree" | "normal" | "monorepo"
  "baseBranch": "main",          // PR 대상 브랜치
  "devBranch": null,             // bare repo일 때 dev 브랜치
  "platform": "github",          // "github" | "bitbucket" | "gitlab"
  "packageManager": "npm",       // "npm" | "yarn" | "pnpm"
  "hooks": {
    "sessionStart": true,
    "preCommit": true,
    "postCommit": true,
    "prePush": true
  },
  "review": {
    "maxRounds": 3,
    "autoFixSeverity": ["CRITICAL", "HIGH", "MEDIUM"],
    "skipSeverity": ["LOW"]
  }
}
```

## 플러그인 구조

```
git-workflow-plugin/
├── .claude-plugin/
│   └── plugin.json              ← 플러그인 매니페스트
├── agents/
│   ├── session-manager.md       ← 세션 매니저 에이전트
│   ├── planner.md               ← 플래너 에이전트
│   ├── env-manager.md           ← 환경 매니저 에이전트
│   ├── code-reviewer.md         ← 코드 리뷰어 에이전트
│   └── shipper.md               ← 시퍼 에이전트
├── skills/
│   ├── start.md
│   ├── status.md
│   ├── plan-work.md
│   ├── worktree.md
│   ├── review.md
│   └── ship.md
├── hooks/
│   ├── session-start.sh         ← SessionStart 훅
│   ├── pre-commit.sh            ← PreCommit 훅
│   └── post-commit.sh           ← PostCommit 훅
├── templates/
│   ├── pr-body.md               ← PR 본문 템플릿
│   └── review-report.md         ← 리뷰 리포트 템플릿
└── README.md
```

## 기존 Anchor-wt 스킬과의 관계
- Anchor-wt의 ship/worktree/plan-work/start/status를 기반으로 범용화
- 하드코딩된 경로/브랜치명 → 자동 감지 로직으로 대체
- Anchor 전용 로직 (bare repo, dev 브랜치) → projectType 분기로 처리
- 리뷰 루프 (ship 내부) → 코드 리뷰어 에이전트로 분리

## 구현 순서
1. 플러그인 스캐폴딩 + plugin.json
2. 프로젝트 구조 자동 감지 로직
3. 세션 매니저 (start, status)
4. 환경 매니저 (worktree)
5. 코드 리뷰어 (review + 리뷰 루프)
6. 시퍼 (ship)
7. 플래너 (plan-work)
8. 훅 등록 자동화
9. 테스트 (Tallia + Anchor-wt 양쪽에서 검증)
