; Replace only byte-identical, known-broken uninstallers from our old releases.
; The fixed uninstaller is generated/verified before this installer is compiled.
; No registry reset, data-directory removal, or integrity-check bypass is used.
!macro customHeader
  CRCCheck force
!macroend

!macro customInit
  !ifndef BUILD_UNINSTALLER
    Push $R0
    Push $R1
    Push $R2
    ReadRegStr $R0 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" "InstallLocation"
    ${If} $R0 != ""
    ${AndIf} ${FileExists} "$R0\Uninstall ${PRODUCT_FILENAME}.exe"
      ${StdUtils.HashFile} $R1 "SHA2-256" "$R0\Uninstall ${PRODUCT_FILENAME}.exe"
      ${If} $R1 == "57935749e1d275858ea14c766cfc81ab89bbfe39e5253e97156d8e97c7a9eaad"
      ${OrIf} $R1 == "33f2b48dbf3d68e042f17dbf256dc2f43f61e6642982d982521fa0c5b9917565"
      ${OrIf} $R1 == "8abce0c7c60b22803453f4c90dff0684dcaa4dbe9ad34d2651bd837e7dae6dc8"
        InitPluginsDir
        File /oname=$PLUGINSDIR\yachiyo-fixed-uninstaller.exe "${UNINSTALLER_OUT_FILE}"
        StrCpy $R2 "$LOCALAPPDATA\YachiyoLive2DStudio\InstallerBackups"
        CreateDirectory "$R2"
        ClearErrors
        CopyFiles /SILENT "$R0\Uninstall ${PRODUCT_FILENAME}.exe" "$R2\$R1.exe"
        ${IfNot} ${Errors}
          CopyFiles /SILENT "$PLUGINSDIR\yachiyo-fixed-uninstaller.exe" "$R0\Uninstall ${PRODUCT_FILENAME}.exe"
        ${EndIf}
        ${If} ${Errors}
          MessageBox MB_OK|MB_ICONSTOP "Could not repair the old Yachiyo uninstaller. Close previous installer/error windows and try again. Your settings and memories have not been removed."
          SetErrorLevel 2
          Quit
        ${EndIf}
        DetailPrint "Repaired the known-invalid legacy Yachiyo uninstaller; original saved in $R2."
      ${EndIf}
    ${EndIf}
    Pop $R2
    Pop $R1
    Pop $R0
  !endif
!macroend
