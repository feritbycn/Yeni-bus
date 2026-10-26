# Ödüllü Reklam Entegrasyonu

- Arayüz: `RewardedAdAdapter` (`src/services/RewardedAdService.ts`). Oyun yalnızca `RewardedAdService` ile konuşur.
- Web: `TestAdAdapter` — 5 sn'lik **"TEST AD"** penceresi. Gerçek reklam gösterilmez, sahte reklam markası kullanılmaz.
- Ödül akışı: reklam tamamlandı → `claim` → `grantOnce` (aynı ödül iki kez verilemez); bekleme süresi 30 sn; ödül türü başına günlük sınır (ör. nakit 5, altın 3); Premium üyeler günde 8 ödülü reklam izlemeden talep edebilir.
- Hata benzetimi: Ayarlar → Geliştirici → "Test reklam hatası".

## Gerçek reklamı açmak için
1. AdMob hesabı, uygulama kaydı, ödüllü reklam birimi.
2. Capacitor eklentisi (ör. topluluk AdMob eklentisi) ile `RewardedAdAdapter` uygulayan `AdMobAdapter` yazın ve `main.ts`'de `TestAdAdapter` yerine Android'de bunu verin.
3. Ödül doğrulaması için sunucu tarafı SSV (Server-Side Verification) önerilir — bu depoda **sunucu yok**.
4. `.env.example` içindeki `VITE_ADMOB_*` değişkenleri şu an **kodda kullanılmıyor**; adaptörü yazarken okuyun. Test birimi kimliklerini geliştirmede kullanın.
5. Çocuklara yönelik/izin (UMP, GDPR) gereklilikleri yayıncının sorumluluğundadır.
