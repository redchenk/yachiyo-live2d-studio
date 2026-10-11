Name "Yachiyo CRC regression fixture"
OutFile "/tmp/yachiyo-uninstaller-fixture.exe"
SetCompressor zlib
CRCCheck force
Function .onInit
  WriteUninstaller "Z:\tmp\fixture-uninstaller.exe"
  Quit
FunctionEnd
Section "install"
SectionEnd
Section "Uninstall"
  DetailPrint "fixture only"
SectionEnd
