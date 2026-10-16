; Adds <install dir>\bin (where fahh.cmd lives) to the user PATH on install and removes it on uninstall.
; Per-user only (HKCU), which is the installer's default mode. Remove-then-append keeps reinstalls from duplicating the entry.
!include "WordFunc.nsh"
!insertmacro WordReplace
!insertmacro un.WordReplace

!macro NSIS_HOOK_POSTINSTALL
  ReadRegStr $0 HKCU "Environment" "Path"
  ${WordReplace} "$0" ";$INSTDIR\bin" "" "+*" $0
  ${If} $0 == "$INSTDIR\bin"
    StrCpy $0 ""
  ${EndIf}
  ${If} $0 == ""
    WriteRegExpandStr HKCU "Environment" "Path" "$INSTDIR\bin"
  ${Else}
    WriteRegExpandStr HKCU "Environment" "Path" "$0;$INSTDIR\bin"
  ${EndIf}
  ; tell running programs (Explorer, new terminals) the environment changed
  System::Call 'user32::SendMessageTimeoutW(i 0xffff, i 0x1A, i 0, w "Environment", i 2, i 5000, *i .r2)'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ReadRegStr $0 HKCU "Environment" "Path"
  ${un.WordReplace} "$0" ";$INSTDIR\bin" "" "+*" $0
  ${If} $0 == "$INSTDIR\bin"
    StrCpy $0 ""
  ${EndIf}
  WriteRegExpandStr HKCU "Environment" "Path" "$0"
  System::Call 'user32::SendMessageTimeoutW(i 0xffff, i 0x1A, i 0, w "Environment", i 2, i 5000, *i .r2)'
!macroend
