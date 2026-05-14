// src/context/ToastContext.tsx
import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { ToastType, Toast } from '../components/Toast';
import { View } from 'react-native';
import { toastEmitter } from '../../../../utils/toastEmitter';

interface ToastContextType {
  showToast: (toast: ToastType) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const ToastProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const [toasts, setToasts] = useState<ToastType[]>([]);

  // Subscribe to global toast emitter so non-React code can trigger toasts
  useEffect(() => {
    const unsubscribe = toastEmitter.subscribe((toast) => showToast(toast));
    return unsubscribe;
  }, []);

  const showToast = (toast: ToastType) => {
    setToasts((prev) => {
      const next = [...prev, toast];
      return next.length > 5 ? next.slice(1) : next;
    });

    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== toast.id));
    }, toast.duration || 3000);
  };

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <View
        style={{
          position: 'absolute',
          top: 70,
          left: 0,
          right: 0,
          flexDirection: 'column',
          alignItems: 'center',
          zIndex: 9999,
        }}
      >
        {toasts.map((toast) => (
          <Toast key={toast.id} {...toast} />
        ))}
      </View>
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};
