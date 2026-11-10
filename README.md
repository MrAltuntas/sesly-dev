# sesly-dev

Dört Sesly reposunun (backend, mobil, yönetim paneli, site) tek ağaçta toplanmış kopyası; yerel geliştirme yığını bunun üstünde kurulur.

## Köken

| Klasör | Kaynak repo | Dal | Commit |
| --- | --- | --- | --- |
| sesly-backend/ | sesly-backend | main | 040bfe04f3c822bfda91492a79f04769805bc2ce |
| sesly-mobile/ | sesly-mobile | main | 348fb0d4e027c2b4bfd303dd9df523784ead3776 |
| sesly-admin-frontend/ | sesly-admin-frontend | main | 0b9fad0866ba9c102ba99827df9f478af7e7530e |
| sesly-frontend/ | sesly-frontend | master | 8b76717aa0d7eb939f57f0f433f6deb497d8be7a |

Kopya yalnız bu commit'lerde izlenen dosyaları içerir; kaynakların git geçmişi gelmez.

## Kopyalanmayanlar

- sesly-backend/.env.example
- sesly-backend/.env.test
- sesly-mobile/.env.example
- sesly-admin-frontend/.env.example
- sesly-frontend/.env.example
- sesly-mobile/.claude/ (tek dosya: settings.local.json; başka makinenin yerel ajan ayarı)

## Kaynaktan sapmalar

Kaynaktan farklı olan dosyalar yalnız aşağıdakilerdir.

Sır görünümlü değerler yer tutucuyla değiştirildi:

- sesly-backend/docker-compose.yml: postgres parolası yerel yer tutucuyla değiştirildi.
- sesly-backend/prisma/seed.ts: yönetici ve kullanıcı parolaları, e-postaları (`admin@sesly.local`, `user@sesly.local`) ve kişi adları yer tutucuyla değiştirildi (console.log satırları dahil).
- sesly-mobile/ios/Sesly/GoogleService-Info.plist: API anahtarı değeri yer tutucuyla değiştirildi; diğer alanlar aynı.

Yerel yığın için yama:

- sesly-frontend/Dockerfile: `ARG VITE_API_BASE_URL=https://api.sesly.io` eklendi (dört satır). Gerekçe: site hukuk metinlerini bu adresten çeker ve değer derlemede gömülür; kaynak Dockerfile'da argüman olmadığı için imaj her zaman üretim API'sine bağlanıyordu. Varsayılan, kodun zaten düştüğü değerdir; argümansız derlenen imaj değişmez.

Kökteki `docker-compose.yml`, `env.example` ve bu README ekibin yazdığı dosyalardır; proje klasörlerindeki kendi `docker-compose.yml` dosyaları kullanılmaz.

## Çalıştırma

Gereken: Docker ve compose v2. Derleme internet ister (Docker Hub, npm, github.com, binaries.prisma.sh, fonts.googleapis.com). Kökte `.env` olmadan açılır.

```bash
docker compose up -d --build     # aç (--wait eklenirse beş servis sağlıklı olana kadar bekler)
docker compose ps                # beş servis "healthy" görünmeli
docker compose down              # kapat (veri kalır)
docker compose down -v           # sıfırla (veritabanı ve Redis verisi silinir)
```

| Servis | Adres | Not |
| --- | --- | --- |
| backend | http://localhost:3000 | sağlık: `/health`, API belgesi: `/api/docs` |
| admin (yönetim paneli) | http://localhost:3001 | |
| site | http://localhost:3002 | |
| postgres, redis | dışarı açık değil | veri adlı volume'larda |

Portlar yalnız 127.0.0.1'e bağlanır. Tarayıcıda `localhost` adını kullan (CORS ona göre ayarlı).

Yerel yönetici girişi (yalnız yerel, ilk açılışta oluşur): `admin@sesly.local` / `sesly-local-admin`. Backend açılışta veritabanı göçlerini kendisi uygular; yönetici hesabı varsa dokunmaz. Başka bir hesapla başlamak için `.env` içinde `ADMIN_EMAIL` ve `ADMIN_PASSWORD` verip `docker compose down -v` ile sıfırla.

### Gerçek anahtarlar

```bash
cp env.example .env     # sonra boş anahtarları doldur
```

`env.example` her değişkeni bir satır açıklamayla listeler; dolu değerler yerel varsayılandır. `.env` git'e girmez. Dosya olarak verilen anahtarlar `secrets/` klasörüne şu adlarla konur (klasör backend'e `/app/secrets` olarak salt okunur bağlanır, içeriği git'e girmez):

| Dosya | Ne için |
| --- | --- |
| secrets/firebase-service-account.json | Firebase ile giriş, şifre sıfırlama, anlık bildirim |
| secrets/google-cloud-service-account.json | Cloud Storage ve Google TTS |
| secrets/google-play-service-account.json | Android abonelik doğrulaması |
| secrets/apple-iap-key.p8 | App Store Server API |

Değişiklikten sonra `docker compose up -d --build`. Yönetim paneli ve sitenin değişkenleri derlemede gömülür, o yüzden `--build` şart.

### Anahtarsızken kapalı kalanlar

Yığın bunlar olmadan açılır; ilgili istek hata döner ya da adım atlanır, günlükte uyarı görünür.

- Firebase dosyası yok: mobil giriş (`/auth/firebase/verify`), şifre sıfırlama ve anlık bildirim çalışmaz. Açılışta "Failed to initialize Firebase Admin" hatası günlüğe düşer; beklenen durumdur.
- Google Cloud dosyası ve gerçek proje kimliği yok: dosya yükleme ve indirme (ses kayıtları, üretilen sesler, kapaklar) ile Google TTS çalışmaz.
- `CARTESIA_API_KEY` yok: ses klonlama ve klon sesle seslendirme çalışmaz.
- `GEMINI_API_KEY` yok: masal bölümleme, dil seviyesi ve yaş grubu değerlendirmesi, çeviri çalışmaz.
- `RESEND_API_KEY` yok: e-posta gönderilmez.
- Play ve App Store anahtarları yok: abonelik doğrulaması ve mağaza webhook'ları çalışmaz.
- Google web OAuth kimliği yok: `/auth/google` web akışı çalışmaz.

Anahtarsız çalıştığı denenenler: yönetici girişi (`POST /admin/auth/login`), hukuk metinleri (`GET /legal/privacy`), API belgesi. Dış servise gitmeyen diğer uçlar (masal ve koleksiyon kayıtları gibi) için ayrı deneme yapılmadı.

### Mobil derleme kontrolü

Mobil uygulama compose servisi değildir. JS paketinin derlendiğini görmek için:

```bash
cd sesly-mobile
npm ci
npx expo export --platform android --output-dir /tmp/sesly-mobile-export
```

Hiçbir ortam değişkeni gerekmez. Kök `.env` değerlerini (ör. `BASE_URL`) kullanmak için son komut yerine: `node --env-file=../.env node_modules/expo/bin/cli export --platform android --output-dir /tmp/sesly-mobile-export`. Cihazda çalıştırma ve mağaza derlemesi bu repoda kapsam dışıdır (`android/app/google-services.json` kopyada yoktur).

