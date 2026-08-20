# Romuel Apps v9.1 — correction icône / captures

Cette version corrige le bug où une capture d'écran pouvait devenir l'icône de l'application.

## Règle
Une image devient l'icône uniquement si son nom contient :
- `logo`
- ou `icon`

Exemples :
- `spa-effectifs-logo.png`
- `spa-effectifs-icon.png`

Les autres images sont traitées comme captures d'écran :
- `screenshot-1.png`
- `capture-2.jpg`
- `preview-home.webp`

Si aucun logo n'est fourni, Romuel Apps affiche les initiales de l'application au lieu de prendre une capture au hasard.
