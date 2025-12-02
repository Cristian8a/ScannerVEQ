import jsQR from "jsqr";
import React, { useState, useRef, useEffect } from 'react';
import { Camera, CheckCircle, XCircle, Users, Clock, Wifi, WifiOff } from 'lucide-react';

const QRScannerApp = () => {
  const [scanning, setScanning] = useState(false);
  const [lastScan, setLastScan] = useState(null);
  const [stats, setStats] = useState({ total: 0, successful: 0, failed: 0 });
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingScans, setPendingScans] = useState([]);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const scanIntervalRef = useRef(null);

  // Configuración del webhook - CAMBIAR ESTA URL
  const WEBHOOK_URL = 'https://starknbn.ddns.net/webhook-test/scan-qr';

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (isOnline && pendingScans.length > 0) {
      syncPendingScans();
    }
  }, [isOnline]);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      });
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
        setScanning(true);
        startScanning();
      }
    } catch (err) {
      alert('No se pudo acceder a la cámara. Verifica los permisos.');
      console.error(err);
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const tracks = videoRef.current.srcObject.getTracks();
      tracks.forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
    }
    setScanning(false);
  };

  const startScanning = () => {
    scanIntervalRef.current = setInterval(() => {
      captureAndDecode();
    }, 500);
  };

  const captureAndDecode = () => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(imageData.data, imageData.width, imageData.height);

    if (code) {
      processQRCode(code.data);
    }
  };

  const processQRCode = async (qrData) => {
    // Evitar escaneos duplicados rápidos
    if (lastScan && lastScan.qrData === qrData && Date.now() - lastScan.timestamp < 3000) {
      return;
    }

    stopCamera();

    try {
      // Parse QR format: EVENT:xxx|LEAD:xxx|TS:xxx|HASH:xxx
      const parts = qrData.split('|').reduce((acc, part) => {
        const [key, value] = part.split(':');
        acc[key] = value;
        return acc;
      }, {});

      const scanData = {
        eventId: parts.EVENT,
        leadId: parts.LEAD,
        hash: parts.HASH,
        scannedAt: new Date().toISOString(),
        qrData: qrData
      };

      if (isOnline) {
        await sendToWebhook(scanData);
      } else {
        // Guardar para sincronizar después
        const pending = [...pendingScans, scanData];
        setPendingScans(pending);
        localStorage.setItem('pendingScans', JSON.stringify(pending));
        
        setLastScan({
          success: true,
          message: 'Guardado offline - Se sincronizará cuando haya conexión',
          qrData: qrData,
          timestamp: Date.now(),
          data: scanData
        });
        
        setStats(prev => ({ ...prev, total: prev.total + 1, successful: prev.successful + 1 }));
      }
    } catch (err) {
      setLastScan({
        success: false,
        message: 'Error al procesar QR: ' + err.message,
        qrData: qrData,
        timestamp: Date.now()
      });
      setStats(prev => ({ ...prev, total: prev.total + 1, failed: prev.failed + 1 }));
    }

    // Auto-reiniciar después de 3 segundos
    setTimeout(() => {
      setLastScan(null);
      startCamera();
    }, 3000);
  };

  const sendToWebhook = async (scanData) => {
    try {
      const response = await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(scanData)
      });

      const result = await response.json();

      if (response.ok) {
        setLastScan({
          success: true,
          message: result.message || 'Asistencia registrada correctamente',
          qrData: scanData.qrData,
          timestamp: Date.now(),
          data: result
        });
        setStats(prev => ({ ...prev, total: prev.total + 1, successful: prev.successful + 1 }));
      } else {
        throw new Error(result.error || 'Error al registrar asistencia');
      }
    } catch (err) {
      setLastScan({
        success: false,
        message: err.message,
        qrData: scanData.qrData,
        timestamp: Date.now()
      });
      setStats(prev => ({ ...prev, total: prev.total + 1, failed: prev.failed + 1 }));
    }
  };

  const syncPendingScans = async () => {
    if (pendingScans.length === 0) return;

    const remaining = [];
    for (const scan of pendingScans) {
      try {
        await sendToWebhook(scan);
      } catch {
        remaining.push(scan);
      }
    }

    setPendingScans(remaining);
    localStorage.setItem('pendingScans', JSON.stringify(remaining));
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-blue-800 to-blue-900 text-white">
      {/* Header */}
      <div className="bg-blue-950 bg-opacity-50 backdrop-blur-sm border-b border-blue-700 p-4">
        <div className="flex items-center justify-between max-w-4xl mx-auto">
          <h1 className="text-2xl font-bold">Eventos VEQ</h1>
          <div className="flex items-center gap-4">
            {isOnline ? (
              <Wifi className="w-5 h-5 text-green-400" />
            ) : (
              <div className="flex items-center gap-2 text-yellow-400">
                <WifiOff className="w-5 h-5" />
                <span className="text-sm">Offline</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto p-4 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white bg-opacity-10 backdrop-blur-sm rounded-lg p-4 border border-white border-opacity-20">
            <div className="flex items-center gap-2 mb-2">
              <Users className="w-5 h-5 text-blue-300" />
              <span className="text-sm text-blue-200">Total</span>
            </div>
            <div className="text-3xl font-bold">{stats.total}</div>
          </div>
          
          <div className="bg-white bg-opacity-10 backdrop-blur-sm rounded-lg p-4 border border-white border-opacity-20">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle className="w-5 h-5 text-green-400" />
              <span className="text-sm text-green-200">Exitosos</span>
            </div>
            <div className="text-3xl font-bold text-green-400">{stats.successful}</div>
          </div>
          
          <div className="bg-white bg-opacity-10 backdrop-blur-sm rounded-lg p-4 border border-white border-opacity-20">
            <div className="flex items-center gap-2 mb-2">
              <XCircle className="w-5 h-5 text-red-400" />
              <span className="text-sm text-red-200">Fallidos</span>
            </div>
            <div className="text-3xl font-bold text-red-400">{stats.failed}</div>
          </div>
        </div>

        {/* Pending Scans Alert */}
        {pendingScans.length > 0 && (
          <div className="bg-yellow-500 bg-opacity-20 border border-yellow-500 rounded-lg p-4">
            <div className="flex items-center gap-2">
              <Clock className="w-5 h-5" />
              <span>{pendingScans.length} escaneos pendientes de sincronizar</span>
            </div>
          </div>
        )}

        {/* Camera View */}
        <div className="bg-white bg-opacity-10 backdrop-blur-sm rounded-lg overflow-hidden border border-white border-opacity-20">
          {!scanning && !lastScan && (
            <div className="aspect-video flex items-center justify-center bg-blue-950 bg-opacity-50">
              <button
                onClick={startCamera}
                className="flex flex-col items-center gap-4 p-8 hover:bg-white hover:bg-opacity-10 rounded-lg transition"
              >
                <Camera className="w-16 h-16" />
                <span className="text-xl font-semibold">Iniciar Escaneo</span>
              </button>
            </div>
          )}

          {scanning && (
            <div className="relative aspect-video bg-black">
              <video
                ref={videoRef}
                className="w-full h-full object-cover"
                playsInline
              />
              <canvas ref={canvasRef} className="hidden" />
              
              {/* Scanning overlay */}
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-64 h-64 border-4 border-blue-400 rounded-lg animate-pulse"></div>
              </div>
              
              <button
                onClick={stopCamera}
                className="absolute top-4 right-4 bg-red-500 hover:bg-red-600 px-4 py-2 rounded-lg font-semibold"
              >
                Detener
              </button>
            </div>
          )}

          {lastScan && (
            <div className={`aspect-video flex items-center justify-center ${
              lastScan.success ? 'bg-green-900' : 'bg-red-900'
            }`}>
              <div className="text-center p-8">
                {lastScan.success ? (
                  <CheckCircle className="w-24 h-24 mx-auto mb-4 text-green-400" />
                ) : (
                  <XCircle className="w-24 h-24 mx-auto mb-4 text-red-400" />
                )}
                <h2 className="text-2xl font-bold mb-2">
                  {lastScan.success ? '¡Registro Exitoso!' : 'Error'}
                </h2>
                <p className="text-lg opacity-90">{lastScan.message}</p>
                {lastScan.data?.nombre && (
                  <p className="text-xl font-semibold mt-4">{lastScan.data.nombre}</p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Instructions */}
        <div className="bg-white bg-opacity-10 backdrop-blur-sm rounded-lg p-6 border border-white border-opacity-20">
          <h3 className="text-lg font-semibold mb-3">Instrucciones:</h3>
          <ul className="space-y-2 text-blue-100">
            <li>• Presiona "Iniciar Escaneo" para activar la cámara</li>
            <li>• Coloca el código QR dentro del marco</li>
            <li>• El sistema registrará automáticamente la asistencia</li>
            <li>• Funciona sin conexión - sincroniza cuando haya internet</li>
          </ul>
        </div>
      </div>

      {/* jsQR Library */}
    </div>
    
  );
};

export default QRScannerApp;