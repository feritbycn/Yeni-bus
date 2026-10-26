# Oyun Özellikleri

Durum etiketleri: **Tam** = oynanabilir ve test edildi · **Kısmi** = çalışır ama sınırlı · **Adaptör** = arayüz hazır, gerçek servis yok.

| Alan | Durum | Not |
|---|---|---|
| Ana menü (16 giriş) | Tam | Hepsi gerçek ekrana bağlı; tarayıcıda hatasız açıldığı doğrulandı |
| 3D sürüş | Tam | Sabit adımlı (1/60 s) fizik, 5 kamera modu, gece/gündüz, dikiz aynası |
| Kontroller | Tam | Klavye, fare/dokunma; mobilde ekran direksiyonu ve butonlar |
| Otobüs modelleri | Tam | 6 prosedürel (eco, standard, coach, luxury, double, electric) + **50 içe aktarılan GLB** (RM-01…RM-50, 5 sınıf × 10 seri; bkz. IMPORTED_BUSES.md) |
| Garaj | Tam | Satın al/sat, boya, kaplama, jant, iç mekân, plaka, 3 seviye yükseltme, tamir, karşılaştırma |
| Yolcu & koltuk | Tam | Koltuk üst sınırı sert; duraklarda iniş-biniş, memnuniyet |
| Şirket & şoförler | Tam | Ofis seviyeleri, AI şoförler, çevrimdışı kazanç (8 sa / 12 sefer sınırlı) |
| Harita & seferler | Kısmi | Kurgusal harita; rota ölçeği 1:20 sıkıştırılmıştır |
| Trafik | Tam | IDM takip, ışıklar (40 sn döngü), radar/kırmızı ışık cezası, ambulans |
| Görevler/başarımlar | Tam | Günlük, haftalık, başarımlar |
| Günlük ödül | Tam | 7 günlük takvim, saat geri alma azaltımı (yalnızca istemci) |
| Ekonomi | Tam | Nakit + altın, defter (ledger), tekrar-güvenli (idempotent) ödüller |
| Ödüllü video | Adaptör | Web'de etiketli TEST reklamı (5 sn) |
| Mağaza | Adaptör | Fiyat kodda yok; web'de yalnızca Test Modu açıkken simüle satın alma |
| Premium | Tam* | Tek PremiumService; *web'de yalnızca test satın alma ile |
| Kayıt | Tam | Sürümlü, yedekten kurtarma, dışa/içe aktarma |
| Ayarlar | Tam | Grafik, ses, kontrol, dil (TR/EN), UI ölçeği |
| Performans | Kısmi | Otomatik kalite/FPS ayarı; gerçek cihazlarda ölçülmedi |
| Ses | Kısmi | Tümüyle sentezlenmiş (WebAudio), prototip kalitesi |
