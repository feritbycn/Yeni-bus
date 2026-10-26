# Premium Sistemi

- Tek kaynak: `PremiumService.isPremium()`. Başka yerde Premium bayrağı tutulmaz.
- Durumlar: `none | active | cancelled | expired | refunded`. İptal edilen abonelik bitiş tarihine kadar aktiftir; iade edilirse hemen kapanır.
- Avantajlar: %20 indirim (`PREMIUM_DISCOUNT`), günlük ek ödül (5.000 nakit + 10 altın), günde 8 ödüllü-video ödülünü reklam izlemeden talep etme, kozmetik seçenekler.
- Süresi dolunca kozmetikler varsayılana düşer (`engine/look.ts`); satın alınan araçlar silinmez.
- Web'de yalnızca Test Modu satın alması ile denenebilir; gerçek abonelik mağaza + sunucu doğrulaması ister.
