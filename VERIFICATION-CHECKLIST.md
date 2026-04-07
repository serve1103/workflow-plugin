# Workflow Plugin 검증 체크리스트

## 완료된 검증

### 모듈 단위 테스트 (224/224 통과)
- [x] 플러그인 구조 검증 (plugin.json, marketplace.json, agents, hooks, standards, templates)
- [x] `claude plugin validate` 완전 통과 (0 warnings)
- [x] detect-project.mjs (git-repo, platform, 캐시 생성/읽기)
- [x] state-manager.mjs (initRun, writeState, readState, hasCompleted, handoff, clean)
- [x] schemas.mjs (유효 데이터 통과, 잘못된 데이터 거부)
- [x] orchestrator.mjs (스케일링, 프리셋, 리뷰어 선택, 중복 제거, 신뢰도 필터)
- [x] minimatch.mjs (glob 패턴 매칭, basename 매칭)
- [x] logger.mjs (startLog, logStage, logUserChoice, logTotals, finishLog, getRecentRuns)
- [x] rollback.mjs (createCheckpoint, getCheckpoint, cleanupCheckpoint)
- [x] custom-stages.mjs (로드, 검증, 검색, 에러 처리)

### 실제 동작 테스트
- [x] 플러그인 설치 + 활성화 (`claude plugin install workflow-plugin@workflow-plugin`)
- [x] `/flow post` — 리뷰 → Human-in-the-Loop 확인 (자연어 호출)
- [x] `/flow review` — 단독 리뷰 + JSON 출력 (자연어 호출)
- [x] `/flow enhance` — 프롬프트 강화 (코드베이스 탐색 → 구체적 수정안)
- [x] `/flow status` — 이전 리뷰 이슈 + 최근 실행 히스토리 + 미커밋 변경 표시
- [x] E2E 파이프라인 (autoMode) — Orchestrate → Review → Fix → Verify → Commit (커밋 0dbebb4 생성)
- [x] 리뷰어 자동 선택 — docs+backend 정확히 선택됨
- [x] 신뢰도 필터링 — 80 미만 이슈 필터링 동작
- [x] CRITICAL 체크 — CRITICAL 발견 시 파이프라인 중단 동작
- [x] Circuit Breaker — 로직 시뮬레이션 확인 (SKILL.md 인식 정확)
- [x] Verify→Fix 루프 — 로직 시뮬레이션 확인

---

## 미완료 검증 — 즉시 가능 (CLI)

### 1. 커밋 diff 검증
- [ ] 에이전트가 만든 커밋 `0dbebb4`의 실제 diff 확인
- [ ] PROMPT.md 수정이 올바른지 검증 (security-scan 참조 제거, autoMode 동기화)
- [ ] 의도하지 않은 변경이 없는지 확인

### 2. 로그 기반 검증
- [ ] `.claude-workflow/logs/`에서 E2E 실행 로그 확인
- [ ] 각 스테이지별 기록 (시간, 결과, 모델) 존재 여부
- [ ] userChoices 기록 여부

### 3. 보완 수정
- [ ] autoMode 원복 (true → false)
- [ ] commit-guard.mjs에 fast exit 추가 (non-git-commit 명령 즉시 리턴)
- [ ] 테스트 임시 파일 정리 (test-flow.txt)

---

## 미완료 검증 — 대화형 세션 필요 (사용자 직접)

### 4. 서브에이전트 격리 확인
- [ ] `/flow post` 실행 시 "Launching agent reviewer-backend..." 로그 확인
- [ ] 리뷰어가 서브에이전트로 실행되는지 (격리된 컨텍스트)
- [ ] 메인 Claude가 직접 리뷰하는 게 아닌지 확인

### 5. 병렬 리뷰어 확인
- [ ] 복수 리뷰어(예: frontend+backend) 활성화되는 파일 변경 후 `/flow post`
- [ ] 리뷰어들이 병렬로 호출되는지 순차인지 확인
- [ ] 결과 합산 + 중복 제거 동작 확인

### 6. model: haiku 적용 확인
- [ ] verifier 에이전트 실행 시 haiku 모델 사용 여부
- [ ] committer 에이전트 실행 시 haiku 모델 사용 여부
- [ ] reviewer-docs 에이전트 실행 시 haiku 모델 사용 여부
- [ ] (확인 방법: 에이전트 호출 로그 또는 토큰 사용량 비교)

### 7. Human-in-the-Loop 인터랙션 확인
- [ ] 리뷰 후 proceed/select/skip/abort 선택지 표시
- [ ] `select` 선택 시 이슈 번호 입력 → 해당 이슈만 수정
- [ ] `skip` 선택 시 Fix 스킵 → Verify → Commit 진행
- [ ] `abort` 선택 시 파이프라인 중단 + 롤백 안내

### 8. 훅 실제 트리거 확인
- [ ] 세션 시작 시 session-init 훅 동작 (미커밋 변경 감지 메시지)
- [ ] `git commit` 시도 시 commit-guard 훅 동작 (리뷰 미실행 경고)
- [ ] Claude 응답 종료 시 stop-checker 훅 동작 (파이프라인 실행 제안)
- [ ] (autoPostWork=true 설정 후 테스트)

### 9. 롤백 실제 동작 확인
- [ ] `/flow post` 실행 → 파이프라인 중간에 abort
- [ ] `/flow rollback` → 파이프라인 전 상태로 복원 확인
- [ ] git stash list에서 체크포인트 확인

---

## 미완료 검증 — 의도적 에러 주입 필요

### 10. Circuit Breaker 실제 발동
- [ ] 의도적으로 수정 불가능한 코드 이슈 생성
- [ ] `/flow post` → proceed → Fix 3라운드 후 동일 에러 반복
- [ ] circuitBreakerTriggered: true + 진단 보고서 생성 확인

### 11. Verify→Fix 루프 실제 발동
- [ ] 의도적으로 린트/빌드 실패하는 코드 작성
- [ ] `/flow post` → Fix 후 Verify 실패 → 재시도 2회 후 중단 확인

### 12. 에이전트 JSON 출력 안정성
- [ ] 10회 이상 `/flow review` 실행하여 JSON 출력 일관성 확인
- [ ] JSON 파싱 실패 시 재시도/에러 처리 동작 확인

---

## 발견된 실제 이슈 (수정 필요)

| # | 이슈 | 심각도 | 상태 |
|---|------|--------|------|
| 1 | commit-guard.mjs가 모든 Bash 호출마다 실행 (성능) | MEDIUM | 미수정 |
| 2 | autoMode가 테스트용으로 true로 변경됨 (원복 필요) | HIGH | 미수정 |
| 3 | test-flow.txt 임시 파일 잔존 | LOW | 미수정 |
| 4 | .omc/state/ 파일이 git에 추적됨 (.gitignore에도) | MEDIUM | 미수정 |
| 5 | PROMPT.md docs 프리셋에 confirm 누락 | MEDIUM | E2E에서 자동 수정됨 (검증 필요) |
| 6 | headless 모드에서 /skill 직접 호출 불가 | LOW | Claude Code 제한, 플러그인 이슈 아님 |
