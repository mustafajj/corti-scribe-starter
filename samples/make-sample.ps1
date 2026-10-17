# Regenerates samples/sample-visit.wav: a short, fictional doctor-patient visit
# spoken by the two voices that ship with Windows (no patient data involved).
# Run from the repo root:  powershell -ExecutionPolicy Bypass -File samples/make-sample.ps1

Add-Type -AssemblyName System.Speech

$doctor  = 'Microsoft David Desktop'
$patient = 'Microsoft Zira Desktop'

$script = @(
  @($doctor,  'Good morning. What brings you in today?'),
  @($patient, 'I have had a cough and a fever for five days, and I get short of breath when I climb the stairs.'),
  @($doctor,  'Are you taking any medications at the moment?'),
  @($patient, 'Metformin, 500 milligrams twice a day, and lisinopril, 10 milligrams. And I am allergic to penicillin.'),
  @($doctor,  'Thank you. Let me examine you. Your temperature is 38.4. Blood pressure is 132 over 84. Oxygen saturation is 95 percent. I can hear crackles in the lower right lung.'),
  @($doctor,  'I think this is community-acquired pneumonia.'),
  @($doctor,  'Because of your penicillin allergy, I will prescribe doxycycline, 100 milligrams twice a day for seven days. Please get a chest X-ray today, and come back in 48 hours if you are not feeling better.'),
  @($patient, 'Okay. Thank you, doctor.')
)

$builder = New-Object System.Speech.Synthesis.PromptBuilder
foreach ($line in $script) {
  $builder.StartVoice($line[0])
  $builder.AppendText($line[1])
  $builder.EndVoice()
  $builder.AppendBreak([TimeSpan]::FromMilliseconds(700))
}

$out = Join-Path $PSScriptRoot 'sample-visit.wav'
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)

$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.SetOutputToWaveFile($out, $format)
$synth.Speak($builder)
$synth.Dispose()

Write-Output "Wrote $out"
