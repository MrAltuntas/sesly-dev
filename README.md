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

Kopyada sır görünümlü değerler yer tutucuyla değiştirildi; başka hiçbir dosya kaynaktan farklı değil.

- sesly-backend/docker-compose.yml: postgres parolası yerel yer tutucuyla değiştirildi.
- sesly-backend/prisma/seed.ts: yönetici ve kullanıcı parolaları, e-postaları (`admin@sesly.local`, `user@sesly.local`) ve kişi adları yer tutucuyla değiştirildi (console.log satırları dahil).
- sesly-mobile/ios/Sesly/GoogleService-Info.plist: API anahtarı değeri yer tutucuyla değiştirildi; diğer alanlar aynı.

## Çalıştırma

