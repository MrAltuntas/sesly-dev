# Legal text updates, September 2026 (voice clone re-open)

> **Superseded (2026-10-19).** The texts quoted below are outdated (they
> still name Stripe and destek@sesly.app). Do not paste them. The current
> Turkish and English texts are the files in
> `src/modules/legal-documents/content/<slug>.<language>.md`; the seeder and
> `scripts/republish-legal.ts` (Turkish only, run with `--dry-run` first)
> both read them. The clone consent text is now version `2026-10-v2`
> (Turkish) / `2026-10-en-v2` (English). This page is kept as a record.

Why: the published privacy policy and data-deletion page claimed voice samples
are deleted after training and that failed deletions are "retried and tracked
in voice_deletion_requests". The real behaviour (as of this change) is:

- the raw recording, its processed WAV copy, the optional consent audio and the
  voice model are kept until the user deletes the voice profile or the account;
- deleting a voice profile deletes those files from our storage, the generated
  samples and narrations made with that voice, and the voice model at Cartesia;
- failed upstream deletions are retried automatically by the voice sweeper
  (every 10 minutes, with backoff, 6 attempts in total) and then flagged for
  manual follow-up;
- processors: Cartesia, Inc. (USA) for cloning and clone synthesis, Google Cloud
  Text-to-Speech for ready-made voices (text only), Google Cloud Storage for
  files, Firebase for auth and push.

The in-app consent text (KVKK açık rıza, version `2026-09-v1`) is served by
`GET /voice-profiles/clone-config` from
`src/modules/voice-profiles/clone-config.constants.ts`. It is marked
"needs legal review"; so are these texts.

## How to publish (production already has these documents)

`LegalDocumentsSeeder` only inserts a slug when the row does not exist. It never
updates an existing document, so deploying the new seeder changes NOTHING in
production. Choose one:

1. Admin panel legal editor (recommended): open "Gizlilik Politikası"
   (`privacy`) and "Veri Silme" (`data-deletion`), paste the Markdown below,
   publish. This creates a new immutable version for each.
2. `npx ts-node -r tsconfig-paths/register scripts/republish-legal.ts` against
   production. Caution: it compares ALL three slugs (`tos`, `privacy`,
   `data-deletion`) with the seeder and republishes every one that differs, so
   any Terms of Service edit made in the admin editor would be overwritten by
   the seeder copy. Only use it if the TOS was never edited in the admin panel.

The Terms of Service (`tos`) text is unchanged except for the 2026-09-28 edit
below.

### 2026-09-28 edit (all three documents)

- The in-body first line "Son güncelleme: ..." was removed from `tos`,
  `privacy` and `data-deletion`: the app already shows the published version's
  date in the header, and the two dates disagreed. The privacy text's
  "Değişiklikler" paragraph now says the publish date is updated instead of
  quoting "Son güncelleme".
- In production, delete that first line (and the blank line after it) in the
  admin legal editor for each of the three documents and publish; for
  `privacy`, also paste the new "Bu Gizlilik Politikasındaki Değişiklikler"
  paragraph from below. (Or use `scripts/republish-legal.ts` with the caveat
  above; it now also republishes `tos`.)
- Quotes: the seeded Markdown uses plain `"` and `'` only. The curly quotes
  seen on the device come from the mobile Markdown renderer
  (`react-native-markdown-display` enables markdown-it's `typographer` by
  default), not from the stored text.

## Gizlilik Politikası (slug: privacy)

```markdown
Bu Gizlilik Politikası, Sesly ("biz", "bize" veya "bizim") olarak, mobil uygulamamız ve ilgili hizmetlerimiz ("Hizmet") aracılığıyla topladığımız, kullandığımız ve paylaştığımız bilgileri açıklamaktadır. Hizmetimizi kullanarak, bu Gizlilik Politikası'nda açıklanan uygulamaları kabul etmiş olursunuz.

## Topladığımız Bilgiler

Hizmetimizi sunmak ve geliştirmek için çeşitli türde bilgiler topluyoruz:

### Doğrudan Sizden Aldığımız Bilgiler

- **Hesap Bilgileri:** Hizmetimize kaydolduğunuzda, e-posta adresiniz gibi bilgileri toplarız. Google veya Apple gibi üçüncü taraf hizmetleriyle kaydolmayı seçerseniz, bu hizmetlerden adınızı, e-posta adresinizi ve profil fotoğrafınızı (varsa) alırız.
- **Ses Kayıtları ve Ses Modelleri (Biyometrik Veri):** Ses klonlama özelliğini kullandığınızda, kaydettiğiniz ses örneğini ("Ses Örneği") ve varsa onay kaydınızı toplarız. Ses Örneği ve ondan oluşturulan ses modeli, 6698 sayılı Kişisel Verilerin Korunması Kanunu (KVKK) kapsamında özel nitelikli kişisel veri (biyometrik veri) sayılır ve yalnızca kayıttan önce uygulamada verdiğiniz açık rızaya dayanarak işlenir. Açık rızanızı verdiğiniz tarih ve onayladığınız metnin sürümü de kaydedilir.
- **Profil Bilgileri:** İsteğe bağlı olarak, profilinize bir fotoğraf eklemeyi seçebilirsiniz.
- **İletişim Bilgileri:** Destek talepleri veya geri bildirimler için bizimle iletişime geçtiğinizde sağladığınız bilgileri toplarız.

### Otomatik Olarak Toplanan Bilgiler

- **Kullanım Verileri:** Hizmetimizle nasıl etkileşimde bulunduğunuza dair bilgileri toplarız. Bu, hangi özellikleri kullandığınızı, hangi hikayeleri oluşturduğunuzu ve uygulama içi etkinliklerinizi içerebilir.
- **Cihaz Bilgileri:** Anlık bildirimler göndermek için cihazınızın kimliğini (device token) topluyoruz.

## Bilgilerinizi Nasıl Kullanıyoruz?

Topladığımız bilgileri aşağıdaki amaçlar için kullanırız:

- **Hizmeti Sunmak ve Yönetmek:** Hesabınızı oluşturmak, kimliğinizi doğrulamak, ödemeleri işlemek ve Hizmetimizin temel işlevlerini (ses klonlama ve hikaye oluşturma gibi) sağlamak.
- **Ses Klonlama:** Ses Örneğinizi yalnızca sesinizin yapay bir kopyasını (ses modeli) oluşturmak ve bu sesle kendi aileniz için masal seslendirmek amacıyla işleriz. Ses Örneğinizi ve ses modelinizi reklam ya da pazarlama amacıyla kullanmayız ve üçüncü kişilere satmayız.
- **İletişim:** Size hizmetle ilgili duyurular, güncellemeler, güvenlik uyarıları ve destek mesajları göndermek.
- **Kişiselleştirme:** Hizmetimizi sizin için daha ilgili ve kişisel hale getirmek.
- **Geliştirme ve Analiz:** Hizmetimizin nasıl kullanıldığını anlamak, hataları gidermek ve yeni özellikler geliştirmek.

## Bilgilerin Paylaşılması ve Üçüncü Taraflar

Kişisel bilgilerinizi sizin onayınız olmadan üçüncü taraflarla pazarlama amacıyla paylaşmayız. Bilgilerinizi yalnızca aşağıdaki durumlar ve taraflarla paylaşırız:

- **Hizmet Sağlayıcılar:** Hizmetimizi işletmemize yardımcı olan üçüncü taraf şirketler ve bireylerle çalışıyoruz. Bu sağlayıcılar, verilerinizi yalnızca bizim adımıza belirli görevleri yerine getirmek için kullanır ve başka bir amaçla ifşa etmemek veya kullanmamakla yükümlüdür.
- **Kimlik Doğrulama:** Kullanıcı kimlik doğrulama hizmetleri için Firebase (Google) kullanıyoruz. Google ve Apple ile sosyal giriş yaptığınızda, bu platformlar kimlik doğrulama sürecini yönetir.
- **Veri Depolama:** Ses Örnekleriniz, oluşturulan masal sesleri ve profil fotoğraflarınız gibi dosyalar Google Cloud Storage üzerinde saklanmaktadır.
- **Ödeme İşlemleri:** Abonelik ödemeleri Stripe, Apple In-App Purchase ve Google Play Billing tarafından işlenir. Kredi kartı bilgilerinizi saklamıyoruz; bu bilgiler doğrudan ilgili ödeme işlemcisine gönderilir.
- **Ses Klonlama ve Klon Sesle Seslendirme:** Ses klonlama ve klonlanmış sesinizle masal seslendirme, Cartesia, Inc. (Amerika Birleşik Devletleri) tarafından sağlanan Sonic modelleriyle yapılır. Ses Örneğiniz, ses modeli oluşturulması için Cartesia'ya iletilir; ses modeli Cartesia altyapısında saklanır ve masallarınızı seslendirmek için kullanılır. Cartesia bu verileri bizim adımıza veri işleyen olarak işler. Bu nedenle ses verilerinizin işlenmesi **yurt dışına veri aktarımı** kapsamındadır ve açık rızanıza dayanır.
- **Hazır Sesler:** Hazır anlatıcı sesleriyle yapılan seslendirmeler Google Cloud Text-to-Speech ile üretilir. Bu işlem için Google'a yalnızca masal metni gönderilir; ses kaydınız gönderilmez.
- **Anlık Bildirimler:** Anlık bildirimleri göndermek için Firebase Cloud Messaging (FCM) ve Apple Push Notification Service (APNS) kullanıyoruz.
- **Yasal Yükümlülükler:** Yasal bir zorunluluk, mahkeme kararı veya resmi bir talep olması durumunda bilgilerinizi ifşa edebiliriz.

## Veri Güvenliği

Bilgilerinizi yetkisiz erişime, değişikliğe, ifşaya veya imhaya karşı korumak için makul teknik ve idari güvenlik önlemleri alıyoruz. Ancak, internet üzerinden hiçbir iletim yönteminin veya elektronik depolama yönteminin %100 güvenli olmadığını lütfen unutmayın.

## Veri Saklama

Kişisel bilgilerinizi, hesabınız aktif olduğu sürece veya size Hizmet sunmak için gerekli olduğu sürece saklarız.

- **Ses Örnekleri ve Ses Modelleri:** Ham ses kaydınız, ondan hazırlanan işlenmiş kopya, varsa onay kaydınız ve ses modeliniz, ilgili ses profilini ya da hesabınızı silene kadar saklanır. Sildiğinizde bu veriler depolama alanımızdan ve Cartesia'dan silinir. Sağlayıcı tarafındaki silme geçici bir hata nedeniyle tamamlanamazsa, sistemimiz silmeyi otomatik olarak yeniden dener.
- **Silme Kayıtları:** Bir ses modelinin silindiğini gösteren kayıt (ses içermez; kullanıcı kimliği, ses profilinin adı, sağlayıcıdaki ses kimliği ve tarih) yasal yükümlülüklerimizi yerine getirebilmek için saklanır.

Yasal yükümlülüklerimize uymak, anlaşmazlıkları çözmek ve anlaşmalarımızı uygulamak için bilgilerinizi gerektiği kadar saklayabiliriz. Herhangi bir anda verilerinizin silinmesini talep edebilir, hesabınızı kapatabilirsiniz.

## Açık Rıza ve Haklarınız

Ses klonlama için verdiğiniz açık rızayı dilediğiniz zaman geri alabilirsiniz. Bunun için uygulamada ilgili ses profilini silmeniz yeterlidir. Hesabınızı silmek de tüm ses kayıtlarınızı ve ses modellerinizi siler. KVKK'nın 11. maddesi kapsamındaki diğer haklarınız (bilgi talep etme, düzeltme, silme, itiraz ve benzeri) için bize [destek@sesly.app](mailto:destek@sesly.app) üzerinden ulaşabilirsiniz.

## Çocukların Gizliliği

Hizmetimiz 13 yaşın altındaki kişilere yönelik değildir. 13 yaşın altındaki çocuklardan bilerek kişisel bilgi toplamıyoruz. Ebeveyn veya vasi iseniz ve çocuğunuzun bize kişisel bilgi verdiğini fark ederseniz, lütfen bizimle iletişime geçin.

## Bu Gizlilik Politikasındaki Değişiklikler

Bu Gizlilik Politikası'nı zaman zaman güncelleyebiliriz. Değişiklik yaptığımızda, yeni politikayı bu sayfada yayınlayacak ve yayın tarihini güncelleyeceğiz. Değişiklikler yürürlüğe girdikten sonra Hizmeti kullanmaya devam etmeniz, yeni politikayı kabul ettiğiniz anlamına gelir.

## İletişim

Bu Gizlilik Politikası ile ilgili herhangi bir sorunuz varsa, lütfen bizimle [destek@sesly.app](mailto:destek@sesly.app) üzerinden iletişime geçin.
```

## Veri Silme (slug: data-deletion)

```markdown
Sesly üzerinde gizliliğinizi koruyun ve verilerinizi yönetin. Bu sayfa, bir ses profilini ya da hesabınızı ve size ait tüm verileri nasıl sileceğinizi açıklamaktadır.

## Bir Ses Profilini Silmek

Kendi sesinizle oluşturduğunuz bir ses profilini sildiğinizde:

- Ham ses kaydınız, ondan hazırlanan işlenmiş kopya ve varsa onay kaydınız depolama alanımızdan silinir.
- Ses modeliniz, ses klonlama sağlayıcımız Cartesia'dan silinir.
- Bu sesle hazırlanan örnek sesler ve masal seslendirmeleri silinir.
- Bu ses için verdiğiniz açık rıza geri alınmış olur.

Bir ses profilini silmek için uygulamadaki ses listenizde ilgili sesi seçip silme seçeneğini kullanın.

## Hesabınızı Nasıl Silersiniz?

Hesabınızı ve bununla ilişkili tüm verileri doğrudan Sesly uygulaması içerisinden silebilirsiniz. Bu işlem **kalıcıdır** ve geri alınamaz.

1. Cihazınızda **Sesly** uygulamasını açın.
2. **Ayarlar** (Profil sekmesi) bölümüne gidin.
3. Sayfanın en altına inerek **Tehlikeli Bölge** (Danger Zone) alanını bulun.
4. **Hesabı Sil** seçeneğine dokunun.
5. Karşınıza çıkan diyalog penceresinde seçiminizi onaylayın.

## Hangi Veriler Silinir?

- **Kişisel Profil:** İsim, e-posta ve tercihleriniz.
- **Oluşturulan İçerikler:** Üretilen tüm hikayeler ve sesli anlatımlar.
- **Ses Kayıtları ve Ses Modelleri:** Tüm ses örnekleriniz, işlenmiş kopyaları ve onay kayıtlarınız depolama alanımızdan silinir; ses modelleriniz Cartesia'dan silinir.
- **Abonelikler:** Etkin abonelikler iptal edilir (varsa).
- **Giriş Hesabı:** Firebase kimlik doğrulama hesabınız silinir.

**Sağlayıcı tarafında silme:** Her ses modeli silme talebi, Cartesia'nın silme arayüzü çağrılarak hemen gerçekleştirilir ve sonucu kayıt altına alınır. Geçici bir hata olursa sistemimiz silmeyi otomatik olarak birkaç kez yeniden dener; yine de tamamlanamazsa talep elle takip edilmek üzere işaretlenir.

**Saklanan kayıt:** Silme işleminin yapıldığını gösteren kayıt (ses içermez; kullanıcı kimliği, ses profilinin adı, sağlayıcıdaki ses kimliği ve tarih) yasal yükümlülüklerimiz için saklanır.

## Manuel Talep

Uygulamaya erişim sağlayamıyorsanız, hesap silme talebinde bulunmak için bize [destek@sesly.app](mailto:destek@sesly.app) adresinden e-posta gönderebilirsiniz. Doğrulama işlemleri için lütfen e-postayı hesabınıza kayıtlı olan e-posta adresinden gönderiniz.
```
