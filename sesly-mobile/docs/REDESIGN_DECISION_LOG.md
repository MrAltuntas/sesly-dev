# Mature Care Redesign — Freestyle / Karar Günlüğü

Bu dosya, "Sesly Prototype.html" tasarımını mobile implemente ederken:
1. Tasarımın **açık olmadığı** ya da **atlandığı** yerlerde aldığım kararları,
2. **Senin istediğin** özelliklere ek olarak eklediğim detayları,
3. Backend yetersizliği yüzünden geçici olarak mock'ladığım yerleri

şeffaf biçimde listeler. Her madde **iptal edilebilir / değiştirilebilir** — dilediğini geri al.

> Yasal olarak okuman şart değil, ama bu liste "aslında şunu başka türlü istemiştim" demeni kolaylaştırır.

---

## 🎨 1. Tasarım sistemi

### 1.1 Italic tamamen yasaklandı
Noto Serif'in italic'i güzel ama tasarım sisteminin hiçbir yerinde italic kullanılmaması kararı aldım (chat1'deki senin sözün: "italic kullanmayalım"). Onboarding/Welcome başlıklarına bile italic düşmedi.

### 1.2 Legacy `Colors` paleti shim olarak kaldı
Tüm eski ekranları tek seferde yeniden yazmak yerine `src/theme/colors.ts` şimdi eski `Colors.primary/background/...` anahtarlarını yeni `T.xxx` palet eşdeğerlerine map ediyor. Böylece bir ekran migrate edilene kadar derleniyor — sadece renkler yanlış gözüküyor. Yavaş yavaş kaldırırız.

### 1.3 Bottom tab bar — BlurView'dan vazgeçildi
Mevcut `expo-blur` koyu tint tabbar'ın yerine düz beyaz yüzey + ince üst hairline + pill aktif indicator yaptım. Mature Care'ın hafif, kağıt-hissi dil'ine daha uygun. Frosted glass koyu arka planda çok daha iyi duruyor, bu light temada cam efekti yapay kalıyor.

### 1.4 Profile — "tab değil, avatar"
Tasarım gereği Profile artık sekme olmaktan çıktı; SHeader sağ üst avatar tıklanarak açılıyor. Bu biraz saklı kalıyor ama chat1'de netleştirilmişti. Alternatif: 4. sekme eklemek. Gerekirse geri döneriz.

---

## 🏠 2. Ana akışlar

### 2.1 HomeScreen bottom-tab switcher (Son dinledikleriniz / Favorileriniz)
"Son dinledikleriniz" backend'de "user narrated stories" benzeri bir endpoint yoksa `storyStore.stories` ilk 5 üzerinden render ediliyor — yani placeholder. Bunu `src/screens/home/HomeScreen.tsx`'deki `recent = storyStore.stories.slice(1, 6)` satırında görebilirsin. Gerçek "son dinlenenler" endpoint'i gelene kadar böyle.

### 2.2 Collections (TAMAMEN YENİ KAVRAM)
Tasarımda var ama backend'de yok. Mobil tarafta 4 koleksiyon client-side sabit olarak duruyor:
- `Uyku Vakti` (trust tone)
- `Maceralar` (accent tone)
- `Klasikler` (sun tone)
- `Sakin Ses` (nature tone)

`CollectionsScreen` bu dizi üzerinden render ediyor. `CollectionDetailScreen` ise story.category alanına heuristik olarak eşleyerek hikayeleri filtreliyor. Backend Collection modülü (bkz. `REDESIGN_BACKEND_CHANGES.md` madde 1) hazır olunca tek satır swap.

**İstersen 4 koleksiyonun isim/metin/ton seçimleri değiştirilebilir.** Şu an `calm` (sakin ses) ve `sleep` (uyku vakti) çakışmalı gibi duruyor — içerik matrisine göre birleştirilebilir.

### 2.3 StoryDetail — voice dropdown inline
Tasarıma sadık kaldım: seslendiriciyi değiştirmek ayrı bir sayfaya gitmiyor, kartın içinde açılıyor. İçinde:
- Kullanıcının READY durumdaki ses profilleri
- Hazır anlatıcılar (preset)  
- Dashed border "+ Yeni ses ekle"

READY profili hiç yoksa tek CTA olarak "Sesini kaydet" öne çıkıyor — boş-state bariyeri.

---

## 🎤 3. Ses klonlama akışı

### 3.1 Referans metin — freestyle
Tasarım sadece "15 saniyelik kısa bir metin okuyun" diyor. Gerçek metin yoktu. Yazdım:
> "Gece olunca gökyüzünde yıldızlar yavaşça belirirdi. Küçük Ay, bir bulutun üstüne oturup dünyanın uyumasını izlerdi. Rüzgâr, ağaçların yapraklarını usulca oynatır; evlerin pencerelerinden sarı bir ışık sızardı. Sonra herkes güzel bir rüyaya dalardı."

~40 kelime, Türkçe'de ortalama konuşma hızında ~15 sn. Bilinçli olarak **sesli harf varyansı yüksek** (a/e/i/o/u dağılımı dengeli), **farklı cümle uzunlukları** var — model eğitimi için daha iyi.

Yerine başka bir metin istersen tek değişiklik.

### 3.2 Voice profile naming — "Benim Sesim" default
CreateVoiceProfile'da isim input'unun default'u `"Benim Sesim"`. Kullanıcı düzenleyebiliyor ama boş gönderirse bu set ediliyor.

### 3.3 Saliye timer — ondalık gösterim
`0.0s → 15.0s`, tek ondalık. Chat1'deki istediğine uydum. 30fps'den fazla update atmıyorum (RAF değil setInterval 100ms).

### 3.4 Kayıt minimum 10s
Tasarımda yoktu. 10 saniyeden kısa kayıtlar backend'e gönderildiğinde Wavespeed MiniMax hata verebildiği için **10s hard-floor** koydum. 10s altına inilince "Devam et" butonu disable.

### 3.5 SWaveform "reactive" — simüle
Gerçek ses amplitude'u almıyor (Nitro Sound API bu veriyi live stream etmiyor). Bunun yerine çoklu sinüs + jitter ile **görsel olarak ses kaydediliyormuş hissi** veriyorum. Konuşurken çubuklar canlı oynuyor. Rapor ettim çünkü "gerçek canlı audio" bekleyen olursa hayal kırıklığı olur.

---

## 🔊 4. Audio player + sheets

### 4.1 Waveform scrubber — 52 bar, fake amplitude
Gerçek audio peak map yok (backend'den gelen segment URL'leri çalarken client-side amplitude analizi yapmadım — pahalı olur). 52 bar her masal için deterministic olarak `hashSeed(narrationId)` ile üretilen varyantlar gösteriyor. Yani aynı masalın scrubber'ı her zaman aynı şekli verir, farklı masalların scrubber'ları birbirinden görsel olarak ayrışır.

### 4.2 Sleep timer — client-side persistence
Seçilen süre ve fadeOut/pauseWhenAsleep toggle'ları AsyncStorage'da saklanıyor. Son kullanılan süre player açıldığında hatırlanıyor. Server-side persistence gerekirse `REDESIGN_BACKEND_CHANGES.md` madde 7'deki `UserPreferences` tablosu var.

### 4.3 "Uyuyunca duraklat" toggle — deneysel
Bunu gerçekten yapmak için cihaz hareket sensörü + mikrofon dinleyen bir native modül gerekir. Şu an toggle var ama işlev **yok**. "🌙 Deneysel" tag ile belirtiyorum. İstersen toggle'ı UI'dan çıkarırız, faaliyete geçmeden reklam yapmış olmayalım.

### 4.4 Playlist — in-memory mock + MobX singleton
Backend Playlist modülü yok. Mobilde PlaylistStore diye basit bir observable singleton, "Bu gece" ve "Uyku serisi" default listelerini tutuyor. Uygulama kapanınca resetleniyor (AsyncStorage'a yazmadım çünkü bu özelliği default davranış olarak komple backend'e devretmek istiyorum — client-side state tutmak kalıcılık illüzyonu verir ve sonra sync çakışması yaratır).

> **Yerine geçti (2026-10-19, release pass, SPEC-audio 6.1):** Çalma listesi yok, yerine cihazda tutulan, hesaba özel bir sıra var: "Sıradakiler" (`src/stores/QueueStore.ts`, `src/stores/queuePlayback.ts`, `src/components/audio/QueueSheet.tsx`). `PlaylistStore`, `PlaylistService`, `models/Playlist`, `PlaylistSheet` ve `player:playlist.*` metinleri silindi. Neden: backend listesi kullanılabilir olmadan önce dört backend değişikliği isterdi (öğelerde başlık, kapak, anlatıcı yok; aynı anlatım iki kez eklenebiliyor; yeniden oluşturulan ya da silinen sesin öğeleri her sıralamayı 400 yapıyor; toplu ekleme yok) ve her taşıma, çıkarma, ekleme ağı bekleyip birbiriyle yarışıyordu. Yerel sıra çevrimdışı ve ekran kapalıyken çalışır, açılışta istek yapmaz, yükleme durumu yoktur. Sıra kendi kendine ilerler: bir masal bitince ses deposu (`bindStoryEnd`) sıradakini başlatır, hiçbir ekran bitiş bayrağı (`didJustFinish`) okumaz. Kalıcılık AsyncStorage'da, kullanıcı başına tek bir anlık görüntü. Adlandırılmış, cihazlar arası eşitlenen listeler ileride mevcut `/playlists` uçlarıyla geri gelebilir; backend modülüne dokunulmadı.

### 4.5 Lock screen — **IMPLEMENTE EDİLMEDİ**
Tasarımda `ScreenLock` var (21:42 saati, playback info). Bu aslında iOS/Android **sistemin** lock screen media widget'ına karşılık geliyor. `react-native-track-player` v4 zaten rich lock-screen controls sağlıyor — iOS için info.plist + Android için foreground service config yeterli.  
Yeni bir "in-app lock screen" yazmadım — OS bunu zaten yapıyor, double work olur. 

Eğer uygulama içinde "ambient mode" (ekran kilitli değil ama uygulama karanlık modda otomatik minimal UI gösteriyor) istiyorsan ayrı bir iş — belirt, ekleyelim.

---

## 👤 5. Profile + Subscription

### 5.1 Profile istatistikleri — 0 gösteriyor
`storiesRead`, `hoursListened`, `voicesTrained` şimdilik hardcoded `0`. `/users/me/stats` endpoint'i gelince (madde 5 backend) 3 satırlık fetch ile dolacak.

### 5.2 Subscription — IAP "Yakında"
Senin tercihine göre IAP'ı sonraya bıraktık. `SubscriptionScreen` UI'ı tam hazır ama purchase CTA'sı tıklanınca sadece `Alert.alert("Yakında aktif olacak")` atıyor. `react-native-iap@14` package.json'da duruyor, wire edilmeye hazır.

### 5.3 "Restore purchases" — placeholder
Aynı şekilde — UI var, aksiyonu yok. Apple Store incelemesinde restore gerekli olduğu için UI'ı bıraktım; IAP gün açılınca bağlarız.

---

## 🔔 6. Bildirim + bağlantı

### 6.1 NotificationsScreen — gerçek service'e bağlı ama empty state çok
Backend'in `/notifications` endpoint'i var, mobilde de `NotificationService` yazıldı ama kullanıcı `VOICE_READY` event'i almış bir durum yok çünkü henüz kayıt da atmadı. Empty state ön planda.

### 6.2 WebSocket reconnect
Socket.io client `App.tsx`'de auth sonrası connect ediyor ama `foreground/background` aware değil — app arkaya gidince socket yaşıyor, cihaz uyuyunca OS kesiyor ama auto-reconnect `socket.io-client`'ın default'una güveniyor. Edge case'de kopuk kalırsa polling fallback var.

### 6.3 NoInternet screen — NetInfo hook yok (global)
"Bağlantın yok" ekranı sadece manuel navigasyonla ulaşılıyor. `@react-native-community/netinfo` event listener'ını App.tsx'te global kurup otomatik fallback yapmadım çünkü offline kullanım şu an FREE'de sıfır — Pro gelince gerekecek. Şimdilik placeholder kaldı.

---

## 📱 7. Platform-spesifik kararlar

### 7.1 iOS background audio
`app.json` → `ios.infoPlist.UIBackgroundModes: ["audio"]` eklenmesi gerekiyor. Mobil agent bunu yaptı mı kontrol et.

### 7.2 Android foreground service
`react-native-track-player` bunu zaten otomatik kuruyor (AndroidManifest.xml'e foreground service permission ekliyor). Ek iş gerek yok.

### 7.3 Font yükleme
`@expo-google-fonts/noto-serif`, `@expo-google-fonts/noto-sans`, `@expo-google-fonts/noto-sans-mono` paketleri `package.json`'a eklendi. Kullanmadan önce `npm install` gerekli.

### 7.4 Track player hâlâ alpha
`react-native-track-player@5.0.0-alpha0` şu an paket. Plan dokümanında v4 stable'a düşülmesi önerildi (senin planın). Redesign pass'i bitince o refactor'u yapmak mantıklı — API değişimi var, dikkatli olmak lazım.

---

## 📋 8. Açıkça yapılmayan şeyler

Şunları **bilerek** yapmadım, sen söyleyince yaparız:

- **i18n:** Her şey Türkçe hardcoded. `i18next` kurulu değil. Bir sonraki pass.
- **Error boundaries per-screen:** Global error handler var, ekran-bazlı Error Boundary yok.
- **Accessibility (VoiceOver / TalkBack):** `accessibilityLabel` kritik butonlarda var ama bütün ekranlar denetlenmedi.
- **Haptic feedback:** Tasarım prototipi önemli etkileşimlerde haptic'i ima ediyor (kayıt başlat, timer apply). Eklemedim — `expo-haptics` ile 5-10 satır iş.
- **Push notification (FCM):** Mobil agent token alıyor olabilir ama backend `NotificationsService:133` TODO/mock — uçtan uca çalışmıyor. Plan dokümanındaki karar: MVP'de pas, WS + polling yeterli.

---

## Hızlı vazgeçme rehberi

| Madde | Yerini bulmak için |
|---|---|
| Referans metin | `src/screens/voice/VoiceRecordingScreen.tsx` → sabit string |
| Koleksiyon isimleri/tonları | `src/screens/collections/CollectionsScreen.tsx` → `COLLECTION_CATALOG` |
| "Yakında" IAP davranışı | `src/screens/subscription/SubscriptionScreen.tsx` → purchase handler |
| Son dinlenenler placeholder | `src/screens/home/HomeScreen.tsx` → `recent = storyStore.stories.slice(1, 6)` |
| Uyuyunca duraklat toggle | `src/components/audio/TimerSheet.tsx` → `pauseWhenAsleep` toggle |
| SWaveform simülasyonu | `src/components/design/index.tsx` → SWaveform component |
| Voice 10s minimum | `src/screens/voice/VoiceRecordingScreen.tsx` → duration check |

Eğer bu liste daha uzun olmalıydı ama sana o kararı sormadım diyeceğin bir yer varsa, söyle — buraya ekleriz.
