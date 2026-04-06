# Workflow Plugin

> Claude Code를 위한 엔드투엔드 개발 파이프라인 자동화 — 프롬프트부터 커밋까지.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Claude Code](https://img.shields.io/badge/Claude_Code-Plugin-blueviolet)](https://code.claude.com)
[![Tests](https://img.shields.io/badge/Tests-100%20passed-brightgreen)]()

[English](README.md) | **한국어**

---

## 개요

Workflow Plugin은 개발 사이클의 반복적인 부분을 자동화합니다. 코드를 작성하면, 나머지는 플러그인이 처리합니다: **리뷰, 확인, 수정, 검증, 커밋**.

```
[코드/문서 작성]
       ↓
[리뷰]    파일 유형에 따라 도메인별 리뷰어 자동 선택
       ↓
[확인]    발견된 이슈를 보고 수정 방식을 직접 결정
       ↓
[수정]    승인된 이슈 자동 수정 (반복 실패 시 서킷 브레이커)
       ↓
[검증]    린트 → 타입체크 → 빌드 → 테스트 (결정론적 도구 실행)
       ↓
[커밋]    변경 요약 리포트 + Conventional Commits 메시지
```

### 핵심 기능

| 기능 | 설명 |
|------|------|
| **5종 도메인 리뷰어** | 문서, 프론트엔드, 백엔드, DA/데이터, 보안 — 파일 경로 기반 자동 선택 |
| **Human-in-the-Loop** | 자동 수정 전 리뷰 결과를 보여줌. proceed / select / skip / abort 선택 |
| **파이프라인 스케일링** | 3줄 변경? 리뷰만. 10+ 파일? 풀 파이프라인 + 확인 게이트 |
| **워크플로우 프리셋** | feature, bugfix, refactor, docs, security — 자동 감지 또는 수동 선택 |
| **롤백** | 파이프라인 전 git stash 체크포인트. 한 명령으로 원복 |
| **리뷰 기준** | 업계 표준 내장. 프로젝트별 기준으로 오버라이드 가능 |
| **커스텀 스테이지** | 파이프라인 스테이지 추가 가능 (changelog, notify, doc-gen 등) |
| **관측 가능성** | 실행 시간, 토큰 사용량, 이슈 수 등 실행 로그 기록 |

---

## 빠른 시작

### 1. 설치

```bash
# 로컬 디렉토리에서
claude plugin install .

# 또는 GitHub에서
claude plugin install serve1103/workflow-plugin
```

### 2. 첫 파이프라인 실행

```bash
# 코드 변경 후:
/flow post
```

### 3. 끝

플러그인이 프로젝트를 자동 감지하고 (언어, 린터, 테스트 러너 등) 적절한 파이프라인을 실행합니다.

---

## 명령어

### 핵심 파이프라인

| 명령어 | 설명 |
|--------|------|
| `/flow` 또는 `/flow post` | 풀 파이프라인 실행 (리뷰 → 확인 → 수정 → 검증 → 커밋) |
| `/flow enhance "프롬프트"` | 모호한 프롬프트를 코드베이스 컨텍스트로 강화 |

### 개별 스테이지

| 명령어 | 설명 |
|--------|------|
| `/flow review` | 리뷰만 — 이슈 발견만 하고 수정하지 않음 |
| `/flow fix` | 수정만 — 이전 리뷰 결과(review.json) 필요 |
| `/flow verify` | 검증만 — 린트, 타입체크, 빌드, 테스트 실행 |
| `/flow commit` | 커밋만 — 메시지 생성 후 커밋 |

### 유틸리티

| 명령어 | 설명 |
|--------|------|
| `/flow rollback` | 마지막 파이프라인 실행 전 상태로 복원 |
| `/flow status` | 현재 파이프라인 상태 + 최근 실행 히스토리 |
| `/flow config` | 설정 대화형 편집 |

---

## 동작 방식

### Phase 1: Pre-Work (코드 작성 전)

**자동 컨텍스트 주입** — 활성화하면 경량 훅이 프로젝트 컨텍스트(구조, 규칙, 최근 변경)를 system-reminder로 주입합니다. 프롬프트는 그대로이고, Claude가 더 많은 맥락을 알고 작업합니다.

**프롬프트 강화** — `/flow enhance "로그인 버그 고쳐줘"`를 실행하면 에이전트가 코드베이스를 탐색하고 구체적인 프롬프트를 생성합니다:

```
전: "로그인 버그 고쳐줘"
후: "src/auth/login.ts의 JWT 토큰 만료 처리 수정.
     현재 토큰 만료 시 500 에러 반환, 401로 변경 필요.
     42번째 줄의 validateToken() 함수가 TokenExpiredError를
     캐치하지만 상태 코드를 올바르게 설정하지 않음."
```

### Phase 2: Post-Work (코드 작성 후)

#### Step 1 — 분석
변경 규모 판단 (trivial/small/normal/large), 프리셋 선택, 리뷰어 결정.

#### Step 2 — 리뷰
도메인별 리뷰어가 병렬 실행. 각 이슈에 심각도 (CRITICAL/HIGH/MEDIUM/LOW)와 신뢰도 점수 (0-100) 부여. 신뢰도 80 미만 이슈는 자동 필터링.

**출력 예시:**
```
## 리뷰 결과
- 활성 리뷰어: 백엔드, 보안
- 발견 이슈: HIGH 2건, MEDIUM 1건, LOW 3건
- 필터링 (낮은 신뢰도): 5건

### HIGH 이슈
1. [src/auth/login.ts:42] 빈 catch 블록이 에러를 무시함 (신뢰도: 92)
   기준: backend.md#error-handling
```

#### Step 3 — 확인 (Human-in-the-Loop)
```
어떻게 진행할까요?
- proceed: 모든 HIGH/MEDIUM 이슈 자동 수정
- select:  수정할 이슈 선택
- skip:    수정 건너뛰고 검증+커밋으로 진행
- abort:   파이프라인 중단 (/flow rollback으로 원복 가능)
```

#### Step 4 — 수정
승인된 이슈를 자동 수정. 최대 3라운드. 동일 에러 3회 반복 시 서킷 브레이커 발동 → 수정 대신 진단 보고서 생성.

#### Step 5 — 검증
린트, 타입체크, 빌드, 테스트 실행. 모두 결정론적 — 도구 exit code로만 pass/fail 판정. 실패 시 수정-검증 루프 (최대 2회).

#### Step 6 — 커밋
변경 요약 리포트와 Conventional Commits 형식 커밋 메시지 생성. 설정에 따라 푸시 또는 PR 생성.

---

## 리뷰어

| 리뷰어 | 모델 | 활성화 조건 |
|--------|------|------------|
| **문서** | haiku | `docs/**`, `*.md` 변경 |
| **프론트엔드** | sonnet | `*.tsx`, `*.vue`, `*.css`, `components/` 변경 |
| **백엔드** | sonnet | `src/api/**`, `routes/**`, `services/**` 변경 |
| **DA/데이터** | sonnet | `migrations/**`, `*.sql`, `prisma/` 변경 |
| **보안** | sonnet | `auth/**`, `crypto/**` 또는 security 프리셋 |

각 리뷰어는 다음을 포함:
- 도메인별 체크리스트 (내장, 오버라이드 가능)
- 신뢰도 점수 (0-100, 임계값: 80)
- 거짓 양성 필터링 규칙
- Failure Modes 섹션 (피해야 할 안티패턴)

---

## 설정

첫 실행 시 `.claude-workflow/config.json`에 자동 생성됩니다.

### 주요 설정

```json
{
  "pipeline": {
    "pre": { "autoContext": false, "enhance": true },
    "post": ["review", "confirm", "fix", "verify", "commit"],
    "preset": "auto"
  },
  "review": {
    "confidenceThreshold": 80,
    "autoMode": false,
    "maxFixRounds": 3,
    "maxVerifyRetries": 2,
    "circuitBreakerThreshold": 3
  },
  "commit": {
    "style": "conventional",
    "autoPush": false
  },
  "rollback": {
    "strategy": "stash",
    "autoCleanup": true
  }
}
```

### 커스텀 리뷰 기준

프로젝트별 기준으로 내장 기준을 오버라이드:

```
.claude-workflow/standards/
├── docs.md        ← 문서 작성 기준
├── frontend.md    ← 프론트엔드 컨벤션
├── backend.md     ← API/DB/에러 처리 규칙
├── data.md        ← 스키마/마이그레이션 정책
└── security.md    ← 보안 요구사항
```

프로젝트 기준이 있으면 내장 기준을 **완전히 대체** (병합이 아닌 오버라이드).

### 커스텀 파이프라인 스테이지

`.claude-workflow/stages/`에 스테이지 추가:

```yaml
---
name: changelog
description: 최근 변경사항으로 CHANGELOG 자동 업데이트
model: sonnet
tools: [Glob, Grep, Read, Write, Edit]
onFailure: skip
---

커밋된 변경사항을 기반으로 CHANGELOG.md를 업데이트합니다.
```

설정에 추가:
```json
"post": ["review", "confirm", "fix", "verify", "changelog", "commit"]
```

---

## 안전 장치

| 장치 | 동작 방식 |
|------|-----------|
| **Human-in-the-Loop** | 자동 수정 전 사용자 승인 필수 |
| **CRITICAL 게이트** | 보안/데이터 손실 이슈 발견 시 파이프라인 즉시 중단 |
| **서킷 브레이커** | 동일 에러 3회 → 수정 중단, 진단 보고서 생성 |
| **롤백** | 매 파이프라인 실행 전 git stash 체크포인트 |
| **권한 격리** | 리뷰어는 코드 수정 불가. 커미터는 파일 편집 불가 |
| **신뢰도 필터** | 신뢰도 80 미만 이슈 자동 제외 |
| **파이프라인 스케일링** | 작은 변경에는 가벼운 파이프라인 실행 |
| **검증-수정 제한** | 최대 2회 루프 후 중단 및 보고 |

---

## 사용 시점 가이드

| `/flow post` 사용 | `/flow post` 비사용 |
|-------------------|---------------------|
| 기능 구현 후 | 탐색적/프로토타입 코드 |
| 버그 수정 후 | WIP 커밋 시 |
| 리팩토링 후 | 설정 파일만 변경 시 |
| PR 생성 전 | 완전한 수동 제어가 필요할 때 |

---

## 플러그인 구조

```
workflow-plugin/
├── agents/          9개 전문 서브에이전트
├── skills/flow/     파이프라인 오케스트레이션 스킬
├── hooks/           5개 라이프사이클 이벤트 훅
├── lib/             11개 Node.js 모듈 (외부 의존성 0)
├── standards/       5개 내장 리뷰 기준
├── templates/       리포트 및 PR 템플릿
└── test/            통합 테스트 (100개)
```

---

## 문제 해결

**설치 후 플러그인이 인식되지 않을 때**
- `.claude-plugin/plugin.json` 존재 및 JSON 유효성 확인
- Claude Code 세션 재시작

**리뷰에서 이슈를 너무 많이/적게 찾을 때**
- `review.confidenceThreshold` 조정 (기본값: 80)
- `.claude-workflow/standards/`에 프로젝트별 기준 추가

**파이프라인이 너무 오래 걸릴 때**
- `pipeline.scaling` 임계값 확인
- 빠른 체크는 `/flow review`만 사용
- 병렬 리뷰어 비활성화: `review.parallelReviewers: false`

**롤백이 작동하지 않을 때**
- `git stash list`에서 workflow-plugin 체크포인트 확인
- git 저장소 내에 있는지 확인

---

## 라이선스

MIT
