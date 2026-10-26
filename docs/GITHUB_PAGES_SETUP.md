# GitHub Pages Kurulumu

1. GitHub'da boş bir depo oluşturun (ör. `roadmaster-bus-empire`).
2. ZIP'i açın, klasörde:
   ```bash
   git init && git add . && git commit -m "RoadMaster ilk sürüm"
   git branch -M main
   git remote add origin https://github.com/<kullanici>/<depo>.git
   git push -u origin main
   ```
3. Depo → **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. **Actions** sekmesinde "CI & Deploy" çalışır (typecheck → test → build → deploy). Yeşil olunca adres:
   `https://<kullanici>.github.io/<depo>/`
5. Vite `base`, iş akışında `BASE_PATH=/<depo>/` olarak otomatik verilir. Yerelde `./` kullanılır.

Sorun giderme: ekran boşsa konsolda 404 varsa `BASE_PATH` depo adıyla uyuşmuyordur; özel alan adında `BASE_PATH=/` kullanın.
