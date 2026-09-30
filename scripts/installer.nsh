; The executable is per-machine; user data is initialized at first launch in
; the launching user's profile, never in the elevated installer's profile.
!macro customInstall
  DetailPrint "OpenPOS creates .openpos in each user's home on first launch."
!macroend
