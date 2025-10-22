import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowRight, Sparkles, Zap, Lock, Globe, Eye, Layers, Box, Move, Ruler, Target, Activity, Radio, Scan, MousePointer, Wand2, GitMerge, RotateCcw, History, Save, Download, Upload, Database } from "lucide-react";
import { useEffect, useState } from "react";

export default function IntroducingPage() {
  const [scrollY, setScrollY] = useState(0);

  useEffect(() => {
    // Enable scrolling for this page
    document.documentElement.style.overflow = 'auto';
    document.body.style.overflow = 'auto';
    const root = document.getElementById('root');
    if (root) {
      root.style.overflow = 'auto';
      root.style.height = 'auto';
    }

    const handleScroll = () => setScrollY(window.scrollY);
    window.addEventListener('scroll', handleScroll);
    
    return () => {
      // Restore overflow hidden when leaving this page
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
      if (root) {
        root.style.overflow = 'hidden';
        root.style.height = '100%';
      }
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  return (
    <div className="bg-black text-white overflow-x-hidden relative">
      {/* Animated Background */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div 
          className="absolute inset-0 opacity-30"
          style={{
            background: `
              radial-gradient(circle at ${20 + scrollY * 0.02}% ${30 + scrollY * 0.01}%, rgba(147, 51, 234, 0.15) 0%, transparent 50%),
              radial-gradient(circle at ${80 - scrollY * 0.015}% ${70 - scrollY * 0.02}%, rgba(220, 38, 38, 0.15) 0%, transparent 50%),
              radial-gradient(circle at ${50 + scrollY * 0.01}% ${50 + scrollY * 0.015}%, rgba(99, 102, 241, 0.1) 0%, transparent 50%)
            `,
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black via-transparent to-black" />
      </div>

      {/* Floating particles */}
      <div className="fixed inset-0 pointer-events-none">
        {[...Array(20)].map((_, i) => (
          <div
            key={i}
            className="absolute w-1 h-1 bg-purple-500/30 rounded-full animate-pulse"
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              animationDelay: `${Math.random() * 3}s`,
              animationDuration: `${2 + Math.random() * 3}s`,
            }}
          />
        ))}
      </div>

      {/* Navigation Bar */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-black/80 backdrop-blur-2xl border-b border-white/10">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/">
            <span className="text-2xl font-black tracking-widest cursor-pointer hover:scale-105 transition-transform" style={{ letterSpacing: '0.15em' }}>
              <span style={{ color: '#fff', fontWeight: '900' }}>SUPER</span>
              <span style={{
                background: 'linear-gradient(45deg, #9333ea, #dc2626)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
                fontWeight: '900'
              }}>BEAM</span>
            </span>
          </Link>
          <Link href="/">
            <Button className="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white font-semibold shadow-lg hover:shadow-purple-500/50 transition-all">
              Open App <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative pt-40 pb-32 px-6 text-center">
        <div className="max-w-6xl mx-auto space-y-10 relative z-10">
          <div 
            className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-indigo-500/20 to-purple-500/20 rounded-full border border-purple-500/30 mb-6 backdrop-blur-xl animate-pulse"
          >
            <Sparkles className="h-5 w-5 text-purple-400" />
            <span className="text-lg font-semibold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
              Introducing Superbeam
            </span>
          </div>
          <h1 className="text-8xl md:text-9xl font-black tracking-tight leading-none">
            The future of<br />
            <span className="bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 bg-clip-text text-transparent animate-gradient">
              medical imaging
            </span>
          </h1>
          <p className="text-3xl text-gray-300 max-w-4xl mx-auto leading-relaxed font-light">
            A revolutionary DICOM viewer engineered for radiation oncology.<br />
            Professional-grade tools. Stunning interface. Unmatched performance.
          </p>
          <div className="flex items-center justify-center gap-6 pt-8">
            <Link href="/">
              <Button size="lg" className="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white font-bold text-xl px-12 py-8 rounded-2xl shadow-2xl hover:shadow-purple-500/50 transition-all duration-300 hover:scale-105">
                Get Started <ArrowRight className="ml-3 h-6 w-6" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Feature Grid - Quick Overview */}
      <section className="py-20 px-6 relative z-10">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-6xl font-black mb-6 bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
              Powerful Features
            </h2>
            <p className="text-2xl text-gray-400">Everything you need, nothing you don't</p>
          </div>
          <div className="grid md:grid-cols-4 gap-6">
            {[
              { icon: Eye, title: "Advanced Viewing", desc: "WebGL-accelerated rendering" },
              { icon: Layers, title: "Multi-Modality Fusion", desc: "CT, PET, MRI registration" },
              { icon: Box, title: "MPR Views", desc: "3D multi-planar reconstruction" },
              { icon: Wand2, title: "AI Contouring", desc: "Smart prediction & propagation" },
              { icon: GitMerge, title: "Boolean Operations", desc: "Union, intersect, subtract" },
              { icon: Move, title: "Margin Tools", desc: "Anisotropic expansions" },
              { icon: Ruler, title: "Measurements", desc: "Distance, angle, HU values" },
              { icon: Database, title: "PACS Integration", desc: "DICOM query/retrieve" },
            ].map((feature, i) => (
              <div 
                key={i}
                className="p-6 rounded-2xl bg-gradient-to-br from-gray-900 to-gray-950 border border-gray-800 hover:border-purple-500/50 transition-all duration-300 hover:scale-105 group"
              >
                <feature.icon className="h-12 w-12 text-purple-400 mb-4 group-hover:text-purple-300 transition-colors" />
                <h3 className="text-xl font-bold mb-2">{feature.title}</h3>
                <p className="text-gray-400">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Patient Management - Detailed */}
      <section className="py-32 px-6 relative">
        <div className="absolute inset-0 bg-gradient-to-r from-indigo-950/30 to-purple-950/30" />
        <div className="max-w-7xl mx-auto relative z-10">
          <div className="grid md:grid-cols-2 gap-20 items-center">
            <div className="space-y-8">
              <div className="inline-block px-4 py-2 bg-purple-500/20 rounded-lg border border-purple-500/30">
                <span className="text-purple-400 font-semibold">PATIENT MANAGEMENT</span>
              </div>
              <h2 className="text-7xl font-black tracking-tight leading-tight">
                Intelligent<br />patient<br />organization
              </h2>
              <p className="text-2xl text-gray-300 leading-relaxed">
                Navigate your patient database with unprecedented ease. Smart search algorithms, 
                intuitive card-based interface, and instant access to what matters most.
              </p>
              <div className="space-y-6">
                {[
                  { icon: Zap, title: "Lightning-Fast Search", desc: "Real-time search across patients, studies, and modalities with instant results" },
                  { icon: Target, title: "Smart Organization", desc: "Automatic grouping by modality, study date, and clinical context" },
                  { icon: History, title: "Recent & Favorites", desc: "Quick access to frequently used patients and recently opened studies" },
                  { icon: Activity, title: "Study Overview", desc: "At-a-glance visualization of series counts, imaging dates, and available modalities" },
                ].map((item, i) => (
                  <div key={i} className="flex gap-4 items-start group">
                    <div className="p-3 rounded-xl bg-purple-500/20 border border-purple-500/30 group-hover:bg-purple-500/30 transition-colors">
                      <item.icon className="h-6 w-6 text-purple-400" />
                    </div>
                    <div>
                      <h3 className="text-xl font-bold mb-1">{item.title}</h3>
                      <p className="text-gray-400">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-3xl overflow-hidden shadow-2xl border border-gray-800 hover:border-purple-500/50 transition-all duration-500 hover:scale-105">
              <img 
                src="/marketing-screenshots/01-main-dashboard.png" 
                alt="Patient Management Dashboard"
                className="w-full h-auto"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Series Selector - Detailed */}
      <section className="py-32 px-6 relative">
        <div className="max-w-7xl mx-auto relative z-10">
          <div className="grid md:grid-cols-2 gap-20 items-center">
            <div className="order-2 md:order-1 rounded-3xl overflow-hidden shadow-2xl border border-gray-800 hover:border-purple-500/50 transition-all duration-500 hover:scale-105">
              <img 
                src="/marketing-screenshots/02-patient-series-selector.png" 
                alt="Series Selector"
                className="w-full h-auto"
              />
            </div>
            <div className="order-1 md:order-2 space-y-8">
              <div className="inline-block px-4 py-2 bg-pink-500/20 rounded-lg border border-pink-500/30">
                <span className="text-pink-400 font-semibold">SERIES SELECTION</span>
              </div>
              <h2 className="text-7xl font-black tracking-tight leading-tight">
                Series selection<br />
                reimagined
              </h2>
              <p className="text-2xl text-gray-300 leading-relaxed">
                Automatic detection of fusion opportunities, registration relationships, 
                and clinical workflow optimization. Your data, perfectly organized.
              </p>
              <div className="space-y-6">
                {[
                  { icon: Layers, title: "Smart Grouping", desc: "Automatic organization by modality, purpose (planning vs verification), and temporal relationship" },
                  { icon: Radio, title: "Fusion Detection", desc: "Intelligent identification of registrable series with one-click activation" },
                  { icon: Box, title: "RT Structure Preview", desc: "Visual preview of available structure sets with structure counts and metadata" },
                  { icon: Activity, title: "Registration Info", desc: "Clear indication of DICOM REG relationships and spatial registration quality" },
                ].map((item, i) => (
                  <div key={i} className="flex gap-4 items-start group">
                    <div className="p-3 rounded-xl bg-pink-500/20 border border-pink-500/30 group-hover:bg-pink-500/30 transition-colors">
                      <item.icon className="h-6 w-6 text-pink-400" />
                    </div>
                    <div>
                      <h3 className="text-xl font-bold mb-1">{item.title}</h3>
                      <p className="text-gray-400">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Professional Viewer - Full Width Showcase */}
      <section className="py-32 px-6 relative">
        <div className="absolute inset-0 bg-gradient-to-b from-purple-950/30 via-black to-black" />
        <div className="max-w-7xl mx-auto text-center space-y-16 relative z-10">
          <div className="space-y-8">
            <div className="inline-block px-4 py-2 bg-indigo-500/20 rounded-lg border border-indigo-500/30">
              <span className="text-indigo-400 font-semibold">DICOM VIEWER</span>
            </div>
            <h2 className="text-7xl md:text-8xl font-black tracking-tight leading-tight">
              Professional-grade<br />viewing experience
            </h2>
            <p className="text-2xl text-gray-300 max-w-4xl mx-auto leading-relaxed">
              WebGL-accelerated rendering delivers desktop-class performance in your browser. 
              Every pixel, perfectly rendered. Every interaction, instantaneous.
            </p>
          </div>
          <div className="rounded-3xl overflow-hidden shadow-2xl border border-gray-800 hover:border-indigo-500/50 transition-all duration-500">
            <img 
              src="/marketing-screenshots/03-main-viewer-ct.png" 
              alt="DICOM Viewer"
              className="w-full h-auto"
            />
          </div>
          <div className="grid md:grid-cols-3 gap-8 pt-8">
            {[
              { icon: Eye, title: "Window/Level", desc: "Real-time adjustment with 8 clinical presets: Soft Tissue, Lung, Bone, Brain, Liver, Mediastinum, Abdomen, Full Range" },
              { icon: Zap, title: "60 FPS Rendering", desc: "Smooth navigation through hundreds of slices with hardware acceleration and intelligent caching" },
              { icon: Target, title: "RT Structure Overlay", desc: "Real-time contour rendering with customizable colors, opacity, and selective visibility controls" },
            ].map((item, i) => (
              <div key={i} className="p-8 rounded-2xl bg-gradient-to-br from-gray-900 to-gray-950 border border-gray-800 hover:border-indigo-500/50 transition-all group">
                <item.icon className="h-12 w-12 text-indigo-400 mb-4 group-hover:scale-110 transition-transform" />
                <h3 className="text-2xl font-bold mb-3">{item.title}</h3>
                <p className="text-gray-400 text-lg">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Fusion - The Crown Jewel */}
      <section className="py-32 px-6 relative">
        <div className="max-w-7xl mx-auto relative z-10">
          <div className="text-center space-y-8 mb-20">
            <div className="inline-block px-4 py-2 bg-purple-500/20 rounded-lg border border-purple-500/30">
              <span className="text-purple-400 font-semibold">MULTI-MODALITY FUSION</span>
            </div>
            <h2 className="text-7xl md:text-8xl font-black tracking-tight leading-tight">
              Fusion.<br />Perfected.
            </h2>
            <p className="text-2xl text-gray-300 max-w-4xl mx-auto leading-relaxed">
              Accurate multi-modality image registration using DICOM spatial coordinates and 
              registration matrices. CT-CT, PET-CT, MRI fusion with sub-millimeter precision.
            </p>
          </div>

          {/* Fusion Feature Grid */}
          <div className="grid md:grid-cols-2 gap-12 mb-20">
            <div className="space-y-6">
              <h3 className="text-4xl font-black mb-8">Advanced Registration</h3>
              {[
                { title: "DICOM REG Support", desc: "Automatic detection and application of DICOM Image Registration (REG) objects for accurate spatial alignment" },
                { title: "Robust Fallbacks", desc: "Intelligent fallback strategies when registration data is incomplete, using Frame of Reference UIDs and patient positioning" },
                { title: "Real-Time Overlay", desc: "Adjustable opacity slider (0-100%) with smooth blending and instant visual feedback" },
                { title: "Background Loading", desc: "Non-blocking image loading keeps the viewer interactive while fusion data streams in" },
              ].map((item, i) => (
                <div key={i} className="p-6 rounded-xl bg-gray-900/50 border border-gray-800 hover:border-purple-500/50 transition-all">
                  <h4 className="text-xl font-bold mb-2 text-purple-400">{item.title}</h4>
                  <p className="text-gray-400">{item.desc}</p>
                </div>
              ))}
            </div>
            <div className="space-y-6">
              <h3 className="text-4xl font-black mb-8">Display Modes</h3>
              {[
                { title: "Overlay Mode", desc: "Blend images with adjustable opacity for direct spatial comparison and hotspot visualization" },
                { title: "Side-by-Side", desc: "Synchronized dual-panel display with independent or linked scrolling and window/level controls" },
                { title: "Quick Toggle", desc: "Instant switching between display modes without losing position or settings" },
                { title: "Series Switcher", desc: "Rapid switching between multiple fused series (CT #1, PET #1, CT #2) without reloading" },
              ].map((item, i) => (
                <div key={i} className="p-6 rounded-xl bg-gray-900/50 border border-gray-800 hover:border-purple-500/50 transition-all">
                  <h4 className="text-xl font-bold mb-2 text-pink-400">{item.title}</h4>
                  <p className="text-gray-400">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Fusion Screenshots */}
          <div className="grid md:grid-cols-2 gap-8">
            <div className="rounded-3xl overflow-hidden shadow-2xl border border-gray-800 hover:border-purple-500/50 transition-all duration-500 hover:scale-105">
              <img 
                src="/marketing-screenshots/04-fusion-view-ct-overlay.png" 
                alt="CT Fusion Overlay"
                className="w-full h-auto"
              />
              <div className="p-8 bg-gradient-to-br from-gray-900 to-gray-950 border-t border-gray-800">
                <h3 className="text-3xl font-black mb-3 text-purple-400">CT-CT Fusion</h3>
                <p className="text-gray-300 text-lg">Real-time overlay with adjustable opacity for planning vs verification comparison</p>
              </div>
            </div>
            <div className="rounded-3xl overflow-hidden shadow-2xl border border-gray-800 hover:border-pink-500/50 transition-all duration-500 hover:scale-105">
              <img 
                src="/marketing-screenshots/06-pet-fusion-overlay.png" 
                alt="PET Fusion Overlay"
                className="w-full h-auto"
              />
              <div className="p-8 bg-gradient-to-br from-gray-900 to-gray-950 border-t border-gray-800">
                <h3 className="text-3xl font-black mb-3 text-pink-400">PET-CT Fusion</h3>
                <p className="text-gray-300 text-lg">Molecular imaging integration with hotspot visualization for target delineation</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Full Interface Showcase */}
      <section className="py-32 px-6 relative">
        <div className="absolute inset-0 bg-gradient-to-r from-indigo-950/20 to-purple-950/20" />
        <div className="max-w-7xl mx-auto text-center space-y-16 relative z-10">
          <div className="space-y-8">
            <div className="inline-block px-4 py-2 bg-indigo-500/20 rounded-lg border border-indigo-500/30">
              <span className="text-indigo-400 font-semibold">WORKSPACE DESIGN</span>
            </div>
            <h2 className="text-7xl md:text-8xl font-black tracking-tight leading-tight">
              Everything.<br />In one place.
            </h2>
            <p className="text-2xl text-gray-300 max-w-4xl mx-auto leading-relaxed">
              A thoughtfully designed interface that puts every tool at your fingertips. 
              No context switching. No confusion. Just pure productivity.
            </p>
          </div>
          <div className="rounded-3xl overflow-hidden shadow-2xl border border-gray-800 hover:border-indigo-500/50 transition-all duration-500">
            <img 
              src="/marketing-screenshots/05-full-interface-fusion.png" 
              alt="Full Interface"
              className="w-full h-auto"
            />
          </div>
          <div className="grid md:grid-cols-4 gap-6 pt-8">
            {[
              { title: "Left Panel", desc: "Series selection, fusion controls, and study navigation" },
              { title: "Center Stage", desc: "High-resolution viewer with full-screen optimization" },
              { title: "Right Panel", desc: "Structures list, window/level, and tool settings" },
              { title: "Bottom Bar", desc: "Comprehensive toolbar with all viewer and editing tools" },
            ].map((item, i) => (
              <div key={i} className="p-6 rounded-xl bg-gray-900/50 border border-gray-800 hover:border-indigo-500/50 transition-all">
                <h3 className="text-xl font-bold mb-2 text-indigo-400">{item.title}</h3>
                <p className="text-gray-400">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* MPR View */}
      <section className="py-32 px-6 relative">
        <div className="max-w-7xl mx-auto relative z-10">
          <div className="grid md:grid-cols-2 gap-20 items-center">
            <div className="space-y-8">
              <div className="inline-block px-4 py-2 bg-green-500/20 rounded-lg border border-green-500/30">
                <span className="text-green-400 font-semibold">3D VISUALIZATION</span>
              </div>
              <h2 className="text-7xl font-black tracking-tight leading-tight">
                Multi-planar<br />reconstruction
              </h2>
              <p className="text-2xl text-gray-300 leading-relaxed">
                Simultaneous axial, sagittal, and coronal views with synchronized navigation. 
                Perfect for understanding complex 3D anatomy and structure extent.
              </p>
              <div className="space-y-6">
                {[
                  { icon: Scan, title: "Real-Time Reformatting", desc: "On-the-fly slice generation from volumetric data with no lag or delay" },
                  { icon: Target, title: "Synchronized Crosshairs", desc: "Click in any view to instantly navigate to that position in all other views" },
                  { icon: Eye, title: "Consistent Windowing", desc: "Uniform window/level across all planes or independent adjustment per view" },
                  { icon: Layers, title: "Structure Overlay", desc: "RT structure visualization in all orientations with proper 3D interpolation" },
                ].map((item, i) => (
                  <div key={i} className="flex gap-4 items-start group">
                    <div className="p-3 rounded-xl bg-green-500/20 border border-green-500/30 group-hover:bg-green-500/30 transition-colors">
                      <item.icon className="h-6 w-6 text-green-400" />
                    </div>
                    <div>
                      <h3 className="text-xl font-bold mb-1">{item.title}</h3>
                      <p className="text-gray-400">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-3xl overflow-hidden shadow-2xl border border-gray-800 hover:border-green-500/50 transition-all duration-500 hover:scale-105">
              <img 
                src="/marketing-screenshots/07-mpr-view.png" 
                alt="MPR View"
                className="w-full h-auto"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Side-by-Side Comparison */}
      <section className="py-32 px-6 relative">
        <div className="max-w-7xl mx-auto relative z-10">
          <div className="grid md:grid-cols-2 gap-20 items-center">
            <div className="order-2 md:order-1 rounded-3xl overflow-hidden shadow-2xl border border-gray-800 hover:border-blue-500/50 transition-all duration-500 hover:scale-105">
              <img 
                src="/marketing-screenshots/10-side-by-side-fusion.png" 
                alt="Side-by-Side Comparison"
                className="w-full h-auto"
              />
            </div>
            <div className="order-1 md:order-2 space-y-8">
              <div className="inline-block px-4 py-2 bg-blue-500/20 rounded-lg border border-blue-500/30">
                <span className="text-blue-400 font-semibold">COMPARISON MODE</span>
              </div>
              <h2 className="text-7xl font-black tracking-tight leading-tight">
                Side-by-side<br />comparison
              </h2>
              <p className="text-2xl text-gray-300 leading-relaxed">
                Compare scans effortlessly with dual-panel display. 
                Perfect for treatment verification, follow-up assessment, and peer review.
              </p>
              <div className="space-y-6">
                {[
                  { icon: Move, title: "Synchronized Navigation", desc: "Link scrolling and slice position across both panels for precise comparison" },
                  { icon: Eye, title: "Independent Controls", desc: "Separate window/level, zoom, and pan for each panel when needed" },
                  { icon: Zap, title: "Instant Toggle", desc: "Switch between overlay and side-by-side modes without losing your position" },
                  { icon: Activity, title: "Peer Review Optimized", desc: "Ideal for treatment planning reviews and quality assurance workflows" },
                ].map((item, i) => (
                  <div key={i} className="flex gap-4 items-start group">
                    <div className="p-3 rounded-xl bg-blue-500/20 border border-blue-500/30 group-hover:bg-blue-500/30 transition-colors">
                      <item.icon className="h-6 w-6 text-blue-400" />
                    </div>
                    <div>
                      <h3 className="text-xl font-bold mb-1">{item.title}</h3>
                      <p className="text-gray-400">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Advanced Contouring Tools */}
      <section className="py-32 px-6 relative">
        <div className="absolute inset-0 bg-gradient-to-b from-purple-950/30 via-black to-black" />
        <div className="max-w-7xl mx-auto relative z-10">
          <div className="text-center space-y-8 mb-20">
            <div className="inline-block px-4 py-2 bg-purple-500/20 rounded-lg border border-purple-500/30">
              <span className="text-purple-400 font-semibold">CONTOURING & EDITING</span>
            </div>
            <h2 className="text-7xl md:text-8xl font-black tracking-tight leading-tight">
              AI-powered<br />contouring suite
            </h2>
            <p className="text-2xl text-gray-300 max-w-4xl mx-auto leading-relaxed">
              Professional-grade contouring tools with intelligent prediction, 
              automated propagation, and comprehensive editing capabilities.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8 mb-16">
            {[
              { 
                icon: Wand2, 
                title: "Smart Brush", 
                desc: "AI-assisted brush tool with intelligent edge detection, automatic contour smoothing, and real-time preview" 
              },
              { 
                icon: MousePointer, 
                title: "Advanced Pen Tool", 
                desc: "Precision point-based contouring with Bézier curves, automatic closure, and sub-pixel accuracy" 
              },
              { 
                icon: Sparkles, 
                title: "Prediction Engine", 
                desc: "Machine learning-powered auto-contouring with slice-to-slice propagation and smart interpolation" 
              },
              { 
                icon: GitMerge, 
                title: "Boolean Operations", 
                desc: "Union, intersection, and subtraction of structures with smart polygon clipping algorithms" 
              },
              { 
                icon: Box, 
                title: "Margin Operations", 
                desc: "Uniform and anisotropic margin expansion (3mm, 5mm, custom) with proper 3D distance transforms" 
              },
              { 
                icon: Activity, 
                title: "Polar Interpolation", 
                desc: "Fast polar interpolation between non-adjacent slices with Smart Nth-slice tools for rapid workflows" 
              },
            ].map((item, i) => (
              <div key={i} className="p-8 rounded-2xl bg-gradient-to-br from-gray-900 to-gray-950 border border-gray-800 hover:border-purple-500/50 transition-all duration-300 hover:scale-105 group">
                <item.icon className="h-14 w-14 text-purple-400 mb-6 group-hover:scale-110 transition-transform" />
                <h3 className="text-2xl font-bold mb-3">{item.title}</h3>
                <p className="text-gray-400 text-lg leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>

          <div className="grid md:grid-cols-2 gap-8">
            <div className="p-10 rounded-2xl bg-gradient-to-br from-purple-950/50 to-pink-950/50 border border-purple-500/30">
              <h3 className="text-3xl font-black mb-6 text-purple-400">Undo System</h3>
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <RotateCcw className="h-6 w-6 text-purple-400" />
                  <span className="text-xl">Unlimited undo/redo with full edit history</span>
                </div>
                <div className="flex items-center gap-3">
                  <History className="h-6 w-6 text-purple-400" />
                  <span className="text-xl">Visual history browser with thumbnails</span>
                </div>
                <div className="flex items-center gap-3">
                  <Save className="h-6 w-6 text-purple-400" />
                  <span className="text-xl">Auto-save with manual save checkpoints</span>
                </div>
              </div>
            </div>
            <div className="p-10 rounded-2xl bg-gradient-to-br from-indigo-950/50 to-blue-950/50 border border-indigo-500/30">
              <h3 className="text-3xl font-black mb-6 text-indigo-400">Data Management</h3>
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <Download className="h-6 w-6 text-indigo-400" />
                  <span className="text-xl">Export to DICOM RT Structure Set format</span>
                </div>
                <div className="flex items-center gap-3">
                  <Upload className="h-6 w-6 text-indigo-400" />
                  <span className="text-xl">Import from existing RTSTRUCT files</span>
                </div>
                <div className="flex items-center gap-3">
                  <Database className="h-6 w-6 text-indigo-400" />
                  <span className="text-xl">PACS send/receive integration</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Technology Stack */}
      <section className="py-32 px-6 relative">
        <div className="max-w-7xl mx-auto text-center space-y-16 relative z-10">
          <div className="space-y-8">
            <div className="inline-block px-4 py-2 bg-indigo-500/20 rounded-lg border border-indigo-500/30">
              <span className="text-indigo-400 font-semibold">TECHNOLOGY</span>
            </div>
            <h2 className="text-7xl md:text-8xl font-black tracking-tight leading-tight">
              Built with modern<br />technology
            </h2>
            <p className="text-2xl text-gray-300 max-w-4xl mx-auto leading-relaxed">
              Superbeam leverages cutting-edge web technologies to deliver 
              desktop-class performance without installation.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            <div className="p-10 rounded-3xl bg-gradient-to-br from-blue-950/50 to-indigo-950/50 border border-blue-500/30 hover:border-blue-500/70 transition-all hover:scale-105 group">
              <Zap className="h-16 w-16 text-blue-400 mb-6 mx-auto group-hover:scale-110 transition-transform" />
              <h3 className="text-3xl font-black mb-4">Lightning Fast</h3>
              <div className="text-gray-300 text-lg space-y-2">
                <p>• WebGL hardware acceleration</p>
                <p>• Web Workers for threading</p>
                <p>• Intelligent caching system</p>
                <p>• 60 FPS rendering target</p>
              </div>
            </div>
            <div className="p-10 rounded-3xl bg-gradient-to-br from-purple-950/50 to-pink-950/50 border border-purple-500/30 hover:border-purple-500/70 transition-all hover:scale-105 group">
              <Lock className="h-16 w-16 text-purple-400 mb-6 mx-auto group-hover:scale-110 transition-transform" />
              <h3 className="text-3xl font-black mb-4">HIPAA Ready</h3>
              <div className="text-gray-300 text-lg space-y-2">
                <p>• Client-side processing</p>
                <p>• Secure HTTPS/TLS</p>
                <p>• Audit logging</p>
                <p>• No cloud storage</p>
              </div>
            </div>
            <div className="p-10 rounded-3xl bg-gradient-to-br from-pink-950/50 to-red-950/50 border border-pink-500/30 hover:border-pink-500/70 transition-all hover:scale-105 group">
              <Globe className="h-16 w-16 text-pink-400 mb-6 mx-auto group-hover:scale-110 transition-transform" />
              <h3 className="text-3xl font-black mb-4">Web-Based</h3>
              <div className="text-gray-300 text-lg space-y-2">
                <p>• No installation required</p>
                <p>• Access from anywhere</p>
                <p>• Auto-updates</p>
                <p>• Cross-platform</p>
              </div>
            </div>
          </div>
          <div className="pt-12">
            <div className="inline-block p-8 rounded-2xl bg-gray-900/50 border border-gray-800">
              <p className="text-xl text-gray-400 mb-4">Built with</p>
              <p className="text-2xl font-bold text-transparent bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text">
                React • TypeScript • WebGL • Cornerstone3D • DICOM • HL7 • FHIR
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Clinical Use Cases */}
      <section className="py-32 px-6 relative">
        <div className="absolute inset-0 bg-gradient-to-r from-indigo-950/30 to-purple-950/30" />
        <div className="max-w-7xl mx-auto relative z-10">
          <div className="text-center space-y-8 mb-20">
            <div className="inline-block px-4 py-2 bg-purple-500/20 rounded-lg border border-purple-500/30">
              <span className="text-purple-400 font-semibold">USE CASES</span>
            </div>
            <h2 className="text-7xl font-black tracking-tight">
              Designed for<br />radiation oncology
            </h2>
          </div>
          <div className="grid md:grid-cols-2 gap-8">
            {[
              {
                title: "Treatment Planning",
                items: ["Target volume delineation", "OAR contouring", "Multi-modality registration", "Plan quality assurance"]
              },
              {
                title: "Adaptive Therapy",
                items: ["Serial imaging comparison", "Target tracking", "Re-contouring workflows", "Dose assessment"]
              },
              {
                title: "Peer Review",
                items: ["Contour review sessions", "Side-by-side comparisons", "Collaborative annotation", "Quality metrics"]
              },
              {
                title: "Research",
                items: ["Clinical trials", "Algorithm validation", "Multi-institutional studies", "Data analysis"]
              },
            ].map((useCase, i) => (
              <div key={i} className="p-10 rounded-2xl bg-gradient-to-br from-gray-900 to-gray-950 border border-gray-800 hover:border-purple-500/50 transition-all hover:scale-105">
                <h3 className="text-3xl font-black mb-6 text-purple-400">{useCase.title}</h3>
                <ul className="space-y-3">
                  {useCase.items.map((item, j) => (
                    <li key={j} className="flex items-center gap-3 text-xl">
                      <span className="text-purple-400">✓</span>
                      <span className="text-gray-300">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Performance Metrics */}
      <section className="py-32 px-6 relative">
        <div className="max-w-7xl mx-auto text-center relative z-10">
          <div className="inline-block px-4 py-2 bg-green-500/20 rounded-lg border border-green-500/30 mb-12">
            <span className="text-green-400 font-semibold">PERFORMANCE</span>
          </div>
          <h2 className="text-6xl font-black mb-20">Benchmarks that matter</h2>
          <div className="grid md:grid-cols-4 gap-8">
            {[
              { value: "< 2s", label: "Image Loading", desc: "Typical CT series (200 slices)" },
              { value: "< 3s", label: "Fusion Init", desc: "Complex multi-modality fusion" },
              { value: "60 FPS", label: "Rendering", desc: "Smooth real-time navigation" },
              { value: "< 100ms", label: "Tool Response", desc: "Instant interaction feedback" },
            ].map((metric, i) => (
              <div key={i} className="p-8 rounded-2xl bg-gradient-to-br from-gray-900 to-gray-950 border border-gray-800 hover:border-green-500/50 transition-all">
                <div className="text-6xl font-black mb-4 text-transparent bg-gradient-to-r from-green-400 to-emerald-400 bg-clip-text">
                  {metric.value}
                </div>
                <div className="text-2xl font-bold mb-2">{metric.label}</div>
                <div className="text-gray-400">{metric.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-40 px-6 relative">
        <div className="absolute inset-0 bg-gradient-to-r from-indigo-600/20 via-purple-600/20 to-pink-600/20" />
        <div className="absolute inset-0">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(147,51,234,0.3)_0%,transparent_70%)]" />
        </div>
        <div className="max-w-5xl mx-auto text-center space-y-12 relative z-10">
          <h2 className="text-7xl md:text-8xl font-black tracking-tight leading-tight">
            Ready to transform<br />your workflow?
          </h2>
          <p className="text-3xl text-gray-300 leading-relaxed">
            Join radiation oncology professionals who are already experiencing 
            the future of medical imaging.
          </p>
          <Link href="/">
            <Button size="lg" className="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white font-black text-2xl px-16 py-10 rounded-2xl shadow-2xl hover:shadow-purple-500/50 transition-all duration-300 hover:scale-110">
              Get Started Now <ArrowRight className="ml-3 h-8 w-8" />
            </Button>
          </Link>
          <p className="text-xl text-gray-400 pt-8">
            No credit card required • Free trial available • Enterprise pricing
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-16 px-6 bg-black border-t border-gray-900">
        <div className="max-w-7xl mx-auto">
          <div className="text-center space-y-6">
            <div className="text-3xl font-black tracking-widest mb-8" style={{ letterSpacing: '0.15em' }}>
              <span style={{ color: '#fff', fontWeight: '900' }}>SUPER</span>
              <span style={{
                background: 'linear-gradient(45deg, #9333ea, #dc2626)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
                fontWeight: '900'
              }}>BEAM</span>
            </div>
            <p className="text-lg text-gray-400">
              © 2025 Superbeam Medical Imaging Platform. All rights reserved.
            </p>
            <p className="text-sm text-gray-500">
              Built with React • TypeScript • WebGL • DICOM Compliant • HIPAA Ready
            </p>
            <div className="flex justify-center gap-8 pt-6">
              <a href="#" className="text-gray-400 hover:text-purple-400 transition-colors">Privacy Policy</a>
              <a href="#" className="text-gray-400 hover:text-purple-400 transition-colors">Terms of Service</a>
              <a href="#" className="text-gray-400 hover:text-purple-400 transition-colors">Contact</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
