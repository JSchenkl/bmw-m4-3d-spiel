# BMW M4 3D Rennspiel

Browser-basiertes 3D-Rennspiel mit dem BMW M4 Competition auf dem Kurs Spa-Francorchamps.

## Starten

```
start.bat
```

Der lokale Webserver startet auf **http://localhost:8000** und öffnet den Browser automatisch.  
Kein Node.js oder Python erforderlich – der Server läuft rein über PowerShell.

## Steuerung

| Taste | Funktion |
|---|---|
| **W** / Pfeil hoch | Gas geben |
| **S** / Pfeil runter | Rückwärts |
| **A** / **D** | Lenken |
| **Leertaste** | Bremsen |
| **L** / **J** | Hochschalten / Runterschalten |
| **T** | Kamera wechseln (Verfolger / Cockpit) |
| **M** | Menü öffnen/schließen |
| 🎮 **Xbox-Controller** | wird automatisch erkannt (RT Gas, LT Bremse, L-Stick Lenken, RB/LB schalten) |
| 🎮 **RB / LB (Automatik)** | Fahrstufe **D** (vorwärts) / **R** (rückwärts) wählen |

## Features

- **BMW M4 GT3 EVO** als 3D-Modell (GLB) mit GT3-Fahrdynamik, Rennsound und Auspuffflammen
- **6 Strecken**: **Spa-Francorchamps 1992** (komplette 3D-Szenerie samt Höhenprofil aus einem Modell – Eau Rouge geht wirklich bergauf!), **Hockenheimring**, **Silverstone**, **Hanoi Street Circuit** (3D-Stadt-Szenerie aus einem Modell), **Circuit Gilles-Villeneuve**, **Interlagos (São Paulo)** – inkl. Gras, Kiesbett und Reifen-Bande
- **Streckenauswahl** vor der Modus-Wahl (Kreuztasten wechseln die Strecke, mit Streckenkarte von oben, Name, Länge und Land)
- **Rennmodus**: Qualifikation, F1-Startampel, **5 Runden** mit Rundenzähler und Platzierung; KI-Gegner mit gleicher Beschleunigung & gleichem Kurven-Grip wie der Spieler, die einander überholen und sich nicht überlappen
- Scheinwerfer & Rücklichter mit Lichtkegeln
- Tag-/Nachtmodus
- Motorgeräusch (synthetisierter GT3-Rennmotor, P58-Charakter) mit Auspuff-Crackles beim Gaswegnehmen
- **Auspuffflammen** beim Hochschalten und bei den Crackles
- Cockpit-Kamera mit Umsehen per Maus
- Automatik- und sequenzielles Schaltgetriebe (6 Gänge)
- Kollisionserkennung (Mauern, Gebäude)
- **Schadensmodell**: Unfälle kosten Motorleistung, Topspeed und Lenkpräzision; ab ~45 % qualmt der Motor, bei 100 % **Totalschaden** (Motor aus) – Reparatur per Boxenstopp
- Startbildschirm mit Auto-Rotation im Nachtmodus

## Physik (BMW M4 GT3 EVO)

- Längsdynamik: Zugkraft, Leistungsgrenze, Luft- und Rollwiderstand (~590 PS, ~1300 kg, 0–100 ≈ 2,8 s, Topspeed ≈ 275 km/h)
- Reiner Hinterradantrieb (GT3)
- Querdynamik: Einspurmodell mit Kammschem Kreis; **Aero-Abtrieb** erhöht den Kurven-Grip mit dem Tempo (bis > 2 g)
- Power-Oversteer bei Hinterradschlupf

## Credits

- Modell **2022 BMW M4 GT3** – Ddiaz Design · [Sketchfab](https://sketchfab.com/3d-models/2022-bmw-m4-gt3-61695f14da8d4821beda6f0e376c2f73) · CC-BY-NC-SA 4.0
- Modell **Mercedes-Benz 300SL Gullwing** – vecarz.com
- Streckendaten – [TUM racetrack-database](https://github.com/TUMFTM/racetrack-database)
- Hanoi-Modell – **Hanoi Street Circuit** von Dave Bored · [Sketchfab](https://sketchfab.com/3d-models/read-description-hanoi-street-circuit-fd942c0f4fc044f4bd5f8091ead9f540) · CC-BY 4.0
- Spa-1992-Layout – **Spa Francorchamps 1992 layout** von Dave Love · [Sketchfab](https://sketchfab.com/3d-models/spa-francorchamps-1992-layout-a1223a21df954b9ebf8eb3b7c682eb99) · CC-BY 4.0
