# Android (APK / AAB)

> **Durum:** Android projesi (Capacitor 7) bu depoda hazırdır ve GitHub Actions ile APK/AAB üretmek üzere kurulmuştur.
> Ancak derlemeyi geliştirme ortamımda **çalıştıramadım** (Android SDK/Gradle indirmeleri orada engelliydi); ilk gerçek derleme GitHub'da yapılacak. Çalışmazsa Actions günlüğündeki hatayı bana gönderin.

## 1) Bulutta derleme (önerilen, bilgisayara kurulum gerekmez)
1. GitHub → **Actions** → **Android APK & AAB** → **Run workflow**.
2. Bitince çalıştırma sayfasının altındaki **Artifacts → RoadMaster-android** dosyasını indirin:
   - `RoadMaster-debug.apk` — telefona doğrudan kurulur (bilinmeyen kaynaklara izin verin). Test içindir.
   - `RoadMaster-debug-NOT-FOR-PLAY.aab` — debug anahtarıyla imzalı; **Play Store kabul etmez**.
   - Anahtar (keystore) ayarlıysa ayrıca `RoadMaster-release.apk` ve **`RoadMaster-release.aab`** (Play Store'a yüklenecek dosya).
3. `v0.1.0` gibi bir etiket (tag) iterseniz dosyalar otomatik bir **GitHub Release**'e eklenir.

## 2) Play Store için imzalı AAB (bir kerelik kurulum)
Keystore'u **kendi bilgisayarınızda** üretin ve kaybetmeyin (kaybederseniz uygulamayı güncelleyemezsiniz):
```bash
keytool -genkeypair -v -keystore release.keystore -alias roadmaster -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 release.keystore      # macOS: base64 -i release.keystore
```
GitHub → Settings → Secrets and variables → Actions → şu 4 secret'ı ekleyin:

| Secret | Değer |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | yukarıdaki base64 çıktısı |
| `ANDROID_KEYSTORE_PASSWORD` | keystore parolası |
| `ANDROID_KEY_ALIAS` | `roadmaster` |
| `ANDROID_KEY_PASSWORD` | anahtar parolası |

Sonra workflow'u yeniden çalıştırın; `RoadMaster-release.aab` çıkar. Keystore ve parolalar depoya **asla** konmaz (`.gitignore` engeller).
Play Console'da "Play App Signing"i açık tutmanız önerilir.

## 3) Yerelde derleme (isteğe bağlı)
Gereksinim: Node 22, JDK 21, Android Studio (SDK 35).
```bash
npm ci
npm run cap:sync          # web build + cap sync android
npm run android:open      # Android Studio; Build > Build Bundle(s) / APK(s)
# veya komut satırı:
cd android && ./gradlew assembleDebug bundleDebug
```
Çıktılar: `android/app/build/outputs/apk/…` ve `…/bundle/…`.

## Ayarlar
- Paket adı: `com.roadmaster.busempire` (`capacitor.config.ts` ve `android/app/build.gradle`). **Yayınlamadan önce kendi alan adınıza göre değiştirin**, sonradan değiştirilemez.
- Yatay mod kilitli (`sensorLandscape`). minSdk 23, target/compileSdk 35 — Play'in güncel hedef-API şartını yayın öncesi kontrol edin.
- `versionCode` her CI çalıştırmasında `github.run_number` ile artar; `versionName` `package.json` sürümüdür.
- Uygulama simgesi/açılış ekranı Capacitor varsayılanıdır; kendi ikonlarınızı `android/app/src/main/res/` altına koyun.

## Yayın öncesi eksikler (dürüst liste)
- **Gerçek reklam ve satın alma yok:** Android sürümünde de TEST adaptörleri çalışır. Gerçek AdMob/Play Billing için bir Capacitor eklentisi ve sunucu doğrulaması gerekir (ADS_INTEGRATION.md, IN_APP_PURCHASES.md). Bu haliyle Play'de "reklam/satın alma" vaat edilmemelidir.
- Gizlilik politikası, veri güvenliği formu, içerik derecelendirmesi ve mağaza görselleri sizin tarafınızdan hazırlanmalıdır.
- Telefon performansı ölçülmedi; düşük kaliteli cihazlarda Ayarlar'dan grafik düşürülmelidir.
- Tam ekran (immersive) mod ve geri tuşu davranışı henüz özelleştirilmedi.
