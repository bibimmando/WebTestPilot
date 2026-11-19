# 팀원 4 작업 공간

- 이름 / GitHub 아이디: shlee705
- 담당 모듈: 미정
- 작업 브랜치: `development` (기능 브랜치 `feature/member-04/<작업명>`는 선택)
- 개발 변경은 `development`에 승인 없이 직접 push할 수 있다.
- `main` 반영은 `development` → `main` PR의 승인·CI 통과 후 총괄 담당자가 병합한다.


<HTS, web test page>
`github link`
https://github.com/shlee705/hts/tree/bug

실시간 주식 거래 hts 사이트.
정상 사이트는 main 브랜치에 있다.

11월18일 기준으로 과거 14일의 kospi 자료를 참고하였다.
테스트의 편의를 위해 거래 가능 시간 및 지수 산출 시간은 24시간으로 한다.(기존 9:00~15:30)
일반적인 주식 시장의 규칙을 따른다.
예시로 최우선호가 거래(상한가 매수시 낮은 가격 호가부터 매수, 하한가 매도시 높은 가격 호가부터 매도) 등이 있다.

기능 명세서를 작성하였다.
