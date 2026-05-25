# ClearMark 🚀
### Intelligent Batch Watermark Remover & High-Performance Image Inpainter
Created by **nakyoS**

[![Built with React](https://img.shields.io/badge/Built%20with-React%20%26%20TypeScript-blue.svg)](https://react.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Styled%20with-Tailwind%20CSS-38B2AC.svg)](https://tailwindcss.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## 🇹🇷 Türkçe Açıklama (Turkish Overview)

**ClearMark AI**, fotoğraflarınızdaki ve videolarınızdaki filigranları (watermark), logoları ve istenmeyen nesneleri tarayıcınızda **tamamen yerel (local olarak)** ve güvenli bir şekilde temizleyen akıllı bir medya işleme (media processing) aracıdır.

### Öne Çıkan Özellikler:
- 🛠️ **Fırça ve Kutu Maskeleme:** Serbest çizim fırçası (Brush) veya akıllı dikdörtgen alanı (Rectangle) ile silinecek filigranı tam olarak işaretleyin.
- 🎬 **Video Workspace:** Videolarınız için özel oynatma, duraklatma ve zaman çizgisinde (timeline scrubbing) kaydırma özellikleri. Filtrelenmiş kareleri HTML5 Canvas aracılığıyla sekans halinde işleyerek temiz çıktılar üretir.
- ⚡ **Toplu Maske Kopyalama (Batch Clone):** Tek bir görselde veya videoda belirlediğiniz filigran maskesini tek tuşla sıradaki **tüm dosyalara kopyalayın**! Aynı konumda filigran barındıran yüzlerce dosyayı saniyeler içinde temizlemek için mükemmeldir.
- 🎨 **Gece Modu (Night Mode):** Göz yorgunluğunu önleyen, koyu gri ve indigo renk paletine sahip şık gece teması ile tam uyum.
- 🔒 **%100 Yerel Veri Güvenliği (Local Processing):** Dosyalarınız **asla harici bir sunucuya yüklenmez**. Piksel iyileştirme algoritması doğrudan bilgisayarınızın işlem gücünü (HTML5 Canvas) kullanarak tarayıcı içerisinde çalışır. Orijinal kaliteniz korunur.
- 📦 **Toplu İndirme (ZIP):** İşlemi biten görselleri tek tek veya orijinal dosya adları korunmuş olarak tek bir **ZIP arşivi** şeklinde indirin. Videolarınızı tek tıkla doğrudan WebM formatında kayıt edin.

---

## 🌍 Features & Capabilities

ClearMark AI is designed for professional batch editing workflows where speed, consistency, and data privacy are paramount.

- **Dual Workspace Modes (Image & Video):** Seamlessly alternate between image and video files. The left interactive queue manages your queue dynamically.
- **Micro-Recorder Engine for Video:** Captures frame buffers sequentially over drawing layers, recording pure, watermark-free streams with custom boundaries.
- **Wavefront Propagation (Onion-Peeling) Algorithm:** Heals target areas using a fast, inverse-squared distance-weighted radial interpolation.
- **High-Contrast Dark Canvas:** Sleek and ultra-modern user interface built with customized premium layout options.
- **Micro-interactions:** Staggered transitions powered by `motion` for fluid feedback.
- **Predefined Presets:** Instantly apply masks to popular watermark corners (Bottom-Right, Bottom-Center, Top-Left, Top-Right, or Center-Diagonal).

---

## 🧠 Nasıl Çalışıyor? (How does the Engine Work?)

The core watermark inpainting engine is implemented entirely in pure client-side TypeScript.

1. **Wavefront Propagation Phase:** 
   The engine reads the coordinates marked on the Canvas. It creates a pixel frontier boundary and recursively propagates known pixels inward toward the center of the masked area.
2. **Weighted Local Pixel Interpolation:**
   Pixel color calculation uses an inverse squared-distance weight function over a $7\times7$ structural neighborhood:
   $$W(d) = \frac{1}{d^2}$$
   This ensures textures transition naturally without leaving sharp edges.
3. **Multi-Pass Spatial Smoothing:**
   After reconstruction, a 3-pass spatial smoothing filter blends boundary values to matches surrounding grain patterns perfectly.
4. **Frame-by-Frame Video Processing:**
   For video files, the canvas overlays are synchronised with the video viewport. The renderer captures frame states through off-screen web interfaces, applies drawing canvas mask buffers in natural loops, and leverages Node/browser `MediaRecorder` API streams to dynamically render clean video recordings without watermark layers.

*Note: Since all operations execute using local CPU cycles inside your browser context, your images never leave your local workspace.*

---

## 🛠️ Kurulum ve Çalıştırma (Installation)

Prerequisites: Make sure you have **Node.js** installed.

```bash
# Repo'yu yerel makinenize clone'layın
git clone <repo_url>

# Proje dizinine gidin
cd clearmark-ai

# Gerekli bağımlılıkları yükleyin
npm install

# Geliştirici (Dev) sunucusunu başlatın
npm run dev
```

The application runs locally on [http://localhost:3000](http://localhost:3000).

---

## 🏗️ Teknolojiler (Tech Stack)

- **Framework:** React 18 / Vite
- **Language:** TypeScript (Strict Type-Safety)
- **Styling:** Tailwind CSS v4
- **Animations:** Motion
- **Icons:** Lucide React

---

## ✒️ Geliştirici / Author
Uygulama **nakyoS** tarafından tasarlanmış ve optimize edilmiştir. Projelerinizde kaynak göstererek özgürce kullanıp geliştirebilirsiniz!

---

## 📄 License
This project is licensed under the MIT License - see the LICENSE file for details.
