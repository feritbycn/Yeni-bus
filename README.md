# RoadMaster: Bus Empire

Tarayıcıda çalışan, gerçek 3D (Three.js) otobüs sürüş + şirket yönetimi oyunu. TypeScript + Vite + Vitest.
Kurgusal harita, 56 otobüs modeli (6 yerleşik + 50 içe aktarılan 3B GLB), yolcu/koltuk sistemi, trafik yapay zekâsı, garaj, şirket, görevler, günlük ödüller,
nakit + altın ekonomisi, Premium, TR/EN dil desteği.

> **Dürüstlük notu:** Web sürümünde reklamlar ve satın almalar **TEST adaptörüdür** (açıkça etiketli, gerçek para/reklam yok).
> Sunucu gerektiren özellikler (gerçek reklam doğrulama, makbuz doğrulama, bulut kayıt) bu depoda **yoktur**.
> Ayrıntı: [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md).

## Çalıştırma
```bash
npm ci
npm run dev        # http://localhost:5173
npm run typecheck
npm test           # 10 dosya, 132 test
npm run build      # dist/
npm run preview
npm run e2e        # isteğe bağlı tarayıcı testi (Playwright gerekir, bkz. docs/TEST_REPORT.md)
```

## Kontroller
W/↑ gaz · S/↓ fren · A D/←→ direksiyon · Space el freni · E motor · 1-4 vites · L far · Z/C sinyal · X dörtlü · H korna ·
K silecek · O kapılar · Tab kamera · B dikiz · M kruz · Esc/P duraklat. Mobilde ekran üstü direksiyon/butonlar.

## Dağıtım
`main` dalına push → `.github/workflows/deploy.yml` (typecheck → test → build → Pages). Adımlar: [docs/GITHUB_PAGES_SETUP.md](docs/GITHUB_PAGES_SETUP.md).

## Android (APK/AAB)
Actions → **Android APK & AAB** → Run workflow. Ayrıntı ve imzalama: [docs/ANDROID_BUILD.md](docs/ANDROID_BUILD.md).

## Belgeler
[Özellikler](docs/GAME_FEATURES.md) · [Mimari](docs/ARCHITECTURE.md) · [Pages](docs/GITHUB_PAGES_SETUP.md) · [Android](docs/ANDROID_BUILD.md) ·
[Reklam](docs/ADS_INTEGRATION.md) · [Satın alma](docs/IN_APP_PURCHASES.md) · [Premium](docs/PREMIUM_SYSTEM.md) ·
[Test raporu](docs/TEST_REPORT.md) · [Bilinen sınırlar](docs/KNOWN_LIMITATIONS.md) · [İçe aktarılan 50 otobüs](docs/IMPORTED_BUSES.md)

Lisans: bkz. LICENSE. Katkı: CONTRIBUTING.md.
