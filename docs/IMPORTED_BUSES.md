# İçe Aktarılan 50 Adet 3B Otobüs (RM_Bus_01 … RM_Bus_50)

Kaynak: kullanıcının sağladığı `RoadMaster_50_Bus_3D` paketi (prosedürel, düşük poligonlu **prototip** modeller; gerçek marka kopyası değildir).

## Dosyalar
- `public/models/RM_Bus_NN.glb` — 50 model (≈1,8 MB toplam, her biri ~35 KB).
- `docs/RM_BUS_CATALOG.json` — paketle gelen katalog (sınıf, boyut, renk, koltuk, hız).
- `src/data/rmBuses.ts` — katalog + oyun dengesi. Boyut, renk, koltuk ve azami hız **katalogdan aynen** alınır; fiyat, güç, tüketim, konfor vb. sınıfa ve "seri"ye (1–10) göre bu dosyada türetilir.
- `src/vehicle/BusAssets.ts` — GLB yükleme ve oyun eksenine çevirme (`parseShell`).
- `src/vehicle/BusModel.ts` — `BusRig.attachShell`: içe aktarılan gövdeyi canlandırır.

## Oyunda ne yapıyor
- **Garaj/Galeri:** 56 model (6 temel + 50 içe aktarılan). Galeride sınıfa göre filtre vardır. Modeller 1. seviyede değil, **2–11. seviyede** açılır.
- **Boya:** boyanmamış otobüs katalog rengini taşır; satın alınan bir boya rengi bunun üstüne yazar.
- **Tekerlekler** dönerken ön tekerlekler direksiyonla döner; **farlar, sinyaller ve stop lambaları** oyun içi ışıklarla çalışır; **kapı** açılıp kapanır; jant rengi ve livery uygulanır.
- Yolcu/koltuk, kokpit göstergesi ve iç mekân prosedürel donanımla devam eder.
- Model yüklenemezse oyun otomatik olarak prosedürel otobüse düşer (konsolda uyarı yazar).

## Dönüştürme notları (paketin kendi özelliklerine uyum)
- Dosyalar Z-yukarı, burun +X yönlü; oyunda burun +z, yolcu kapısı sağ (−x). Dönüşüm yansıtma içerdiği için üçgen sarım yönü çevrilir.
- Renkler vertex rengi olarak sRGB baytları doğrusal alana yazılmış; yüklenirken düzeltilir (katalog renkleriyle aynı görünsün diye).
- Dosyalarda normal ve doku yoktur: düz gölgeli (flat) low-poly görünüm kullanılır.
- Parçalar sabit palet renginden tanınır (cam, lastik, jant, far…). Her dosya için testler 4 tekerlek, kapı, gövde ve cam bulunduğunu doğrular.

## Bilinen sınırlar
- Modellerin kendi içinde silecek, ayna hareketi ve ayrıntılı iç mekân yoktur; ön cam silecekleri bu modellerde görünmez.
- Kapı bölgesi dardır (≈0,7 m) ve gövdenin ortasındadır (katalog modeli böyle).
- Modeller prototiptir: UV, PBR doku, LOD, çarpışma gövdesi ve ticari lisans kontrolü yapılmamıştır (paket README'sine bakın).
- Gerçek cihazda performans ölçülmedi; bir araç ~45 parçadan oluşur ve rig başına ~10 çizim çağrısına birleştirilir.
