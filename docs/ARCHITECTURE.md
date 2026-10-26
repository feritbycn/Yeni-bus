# Mimari

```
src/
  core/      types, state (tek GameState), GameContext (yöneticileri bağlar), EventBus, AudioManager, PerformanceManager, utils
  data/      buses, rmBuses (50 içe aktarılan model), cosmetics, drivers, missions, shop (fiyatsız ürün kataloğu), world (şehirler/rotalar), constants
  systems/   Save, Settings, Clock, Economy, Garage, Company, Route, Passenger, Mission, DailyReward, Trip
  services/  RewardedAdService, PurchaseService, PremiumService + adapters/ (TestAd, WebStore, TestPurchase)
  vehicle/   VehicleController (fizik), BusModel (3D rig), BusAssets (GLB yükleme/dönüştürme)
  traffic/   TrafficManager
  world/     RoadPath, RoadWorld, SceneryField, Environment, Textures
  engine/    GameEngine, DriveSession, CameraController, InputManager, look
  ui/        UIManager, hud, dom (h()), screens/*
  i18n/      LocalizationManager, tr.ts, en.ts (732 anahtar, eşitlik testle zorunlu)
```

## İlkeler
- **Tek durum:** `GameState` tek yerde, sürümlü kaydedilir. Yöneticiler durumu `GameContext` üzerinden paylaşır.
- **Ekonomi:** tüm para hareketi `EconomyManager` üzerinden; defter kaydı + `grantOnce(id)` ile çift ödül engellenir.
- **Sabit adım:** `DriveSession` birikimli sabit adım (en fazla 6 adım/kare); render ayrıdır.
- **Adaptör deseni:** reklam ve satın alma gerçek SDK'yı yalnızca adaptörde görür; oyun mantığı arayüze bağlıdır.
- **Premium** yalnızca `PremiumService` üzerinden sorgulanır.
- **UI:** XSS'e karşı yalnızca metin düğümü üreten `h()`; innerHTML kullanılmaz.
- **Koordinatlar:** heading h → ileri=(sin h, cos h); sağ=(-cos h, sin h).
