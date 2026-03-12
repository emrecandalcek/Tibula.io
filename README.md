# 🚀 NEBULA.io — Railway Deploy Talimatları

## Adım 1: GitHub'a Yükle

1. [github.com](https://github.com) → ücretsiz hesap aç
2. **New Repository** → isim: `nebula-io` → **Public** → **Create**
3. Bilgisayarında ZIP'i çıkart
4. GitHub sayfasında **"uploading an existing file"** linkine tıkla
5. Tüm dosyaları sürükle-bırak → **Commit changes**

## Adım 2: Railway'e Deploy Et

1. [railway.app](https://railway.app) → **GitHub ile giriş yap**
2. **New Project** → **Deploy from GitHub repo**
3. `nebula-io` repo'sunu seç
4. Railway otomatik algılar: `package.json` → Node.js projesi
5. **Deploy** butonuna bas → 2 dakika bekle ✅

## Adım 3: Domain Al (Ücretsiz)

1. Railway dashboard → projeye tıkla
2. **Settings** → **Networking** → **Generate Domain**
3. `nebula-io-production.up.railway.app` gibi bir URL verir
4. Bu URL'yi arkadaşlarınla paylaş — herkese açık!

## Adım 4: Kontrol Et

Siteye gir → oyun başlar → 2 pencere aç → ikisi de aynı sunucuda görünür ✅

---

## Dosya Yapısı

```
nebula-io/
├── server.js          ← Ana sunucu (Node.js + Socket.io)
├── package.json       ← Bağımlılıklar
└── public/            ← Tüm frontend dosyaları
    ├── index.html
    ├── game.html
    ├── js/
    │   ├── game-mp.js  ← Multiplayer client
    │   ├── core.js
    │   └── shop.js
    └── css/
        └── ...
```

## Ücretsiz Plan Limitleri

| Limit | Değer |
|-------|-------|
| Aylık çalışma süresi | 500 saat (~20 gün) |
| RAM | 512 MB |
| CPU | Paylaşımlı |
| Eş zamanlı oyuncu | ~50-100 kişi |

## Sorun Giderme

**Oyun açılmıyor?** → Railway logs'a bak: `console.log` hataları görünür  
**Bağlantı kesildi?** → Ücretsiz plan 500 saat dolunca durur, bir sonraki ay başında resetlenir  
**Yavaş?** → Railway sunucusu ABD'de, Türkiye'den ~120-180ms ping normal
