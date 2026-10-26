# Uygulama İçi Satın Alma

- Katalog: `src/data/shop.ts` — **fiyat yok**. Görünen fiyat `PurchaseAdapter.getProducts()` ile mağazadan gelir.
- Ürünler: 6 tüketilebilir (nakit/altın/yakıt/etkinlik paketleri), 4 kalıcı (reklamsız, kozmetik paketi, garaj genişletme, Luxury kilidi), 2 abonelik (premium aylık/yıllık).
- Web: `WebStoreAdapter` mevcut değil (satın alma kapalı). `TestPurchaseAdapter` yalnızca Ayarlar'da **Test Modu** açıkken devreye girer; ekranda "TEST" etiketi görünür, gerçek para yoktur.
- Güvenlik mantığı (`PurchaseService`): işlem kimliği ile tekrar koruması, doğrulanmamış (`verified:false`) sonuç reddi, iade/iptal güncellemeleri, geri yükleme (restore).

## Gerçek satın alma için
1. Play Console'da yukarıdaki ürün kimliklerini aynı `id` ile oluşturun.
2. Google Play Billing'e bağlanan bir Capacitor eklentisiyle `PurchaseAdapter` uygulayın (`getProducts`, `purchase`, `restore`, `subscribe`).
3. **Sunucuda makbuz doğrulayın** (Play Developer API). İstemci tek başına güvenilir değildir. Bu depoda sunucu yoktur.
4. Onaylanmış tüketilebilirleri `acknowledge/consume` edin.
