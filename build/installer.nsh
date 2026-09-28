; electron-builder NSIS 사용자 매크로 (package.json build.nsis.include)
;
; 업데이트 = 새 설치 파일을 그대로 실행. 설치 파일은 먼저 옛 제거 프로그램을 조용히 돌려 옛 파일을 걷는데,
; 서명 없는 실행 파일을 막는 PC(Windows 스마트 앱 컨트롤)에서는 그 제거 프로그램이 막히거나 실패한다.
; 기본 동작은 실패 코드면 "Failed to uninstall old application files"를 띄우고 설치를 멈춘다 —
; 그러면 업데이트할 길이 없다. 그래서 옛 제거가 안 돼도 멈추지 않고 새 파일로 덮어 설치한다.
; 데이터(%APPDATA%\wolfpack)는 제거 프로그램과 무관하게 늘 남는다.

!macro customUnInstallCheck
  ${If} ${Errors}
    DetailPrint "옛 버전 제거 프로그램을 실행하지 못했습니다 — 새 파일로 덮어써 업데이트합니다."
  ${ElseIf} $R0 != 0
    DetailPrint "옛 버전 제거 프로그램 종료 코드 $R0 — 새 파일로 덮어써 업데이트합니다."
  ${EndIf}
  ClearErrors
!macroend

!macro customUnInstallCheckCurrentUser
  !insertmacro customUnInstallCheck
!macroend
