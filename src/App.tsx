import React, { useState, useEffect, useRef } from 'react';
import { 
  Users, 
  UserPlus, 
  History, 
  LayoutDashboard, 
  Search, 
  LogIn, 
  LogOut,
  Plus,
  X,
  CheckCircle2,
  Check,
  Clock,
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  BarChart3,
  Edit2,
  CreditCard,
  CalendarDays,
  Euro,
  Activity,
  XCircle,
  Settings,
  Lock,
  RefreshCw,
  Trash2,
  Sun,
  Moon
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Cell
} from 'recharts';
import { Member, AttendanceRecord, Stats } from './types';

export default function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'members' | 'history' | 'analytics' | 'kiosk' | 'advanced'>('kiosk');
  const [isAdmin, setIsAdmin] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [password, setPassword] = useState('');
  const [advancedPassword, setAdvancedPassword] = useState('');
  const [isAdvancedUnlocked, setIsAdvancedUnlocked] = useState(false);
  const [loginError, setLoginError] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [activeAttendance, setActiveAttendance] = useState<AttendanceRecord[]>([]);
  const [history, setHistory] = useState<AttendanceRecord[]>([]);
  const [dailyStats, setDailyStats] = useState<{date: string, count: number}[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [stats, setStats] = useState<Stats>({ totalMembers: 0, activeNow: 0, todayCount: 0 });
  const [isModalOpen, setIsModalOpen] = useState(false);
  const isModalOpenRef = useRef(false);
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [selectedDayHistory, setSelectedDayHistory] = useState<AttendanceRecord[]>([]);
  const [isDayHistoryOpen, setIsDayHistoryOpen] = useState(false);
  const [selectedDateLabel, setSelectedDateLabel] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isMemberDetailsOpen, setIsMemberDetailsOpen] = useState(false);
  const [selectedMemberHistory, setSelectedMemberHistory] = useState<AttendanceRecord[]>([]);

  const handleDayClick = async (dateStr: string) => {
    try {
      const res = await fetch(`/api/attendance/history?date=${dateStr}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedDayHistory(data);
        setSelectedDateLabel(new Date(dateStr).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' }));
        setIsDayHistoryOpen(true);
      }
    } catch (error) {
      console.error("Error fetching day history:", error);
    }
  };
  const [nfcMessage, setNfcMessage] = useState<{text: string, type: 'success' | 'error', data?: any} | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [scannedCard, setScannedCard] = useState<string>('');
  const lastSwipeTimeRef = useRef<number>(Date.now());

  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    type?: 'danger' | 'info';
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  const [alertDialog, setAlertDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    type?: 'success' | 'error' | 'info';
  }>({
    isOpen: false,
    title: '',
    message: '',
  });

  const showConfirm = (title: string, message: string, onConfirm: () => void, type: 'danger' | 'info' = 'info') => {
    setConfirmDialog({ isOpen: true, title, message, onConfirm, type });
  };

  const showAlert = (title: string, message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setAlertDialog({ isOpen: true, title, message, type });
  };

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  const fetchData = async (isPolling = false) => {
    try {
      const [membersRes, activeRes, historyRes, statsRes, dailyRes, alertsRes] = await Promise.all([
        fetch('/api/members'),
        fetch('/api/attendance/active'),
        fetch('/api/attendance/history'),
        fetch('/api/stats'),
        fetch('/api/attendance/daily'),
        fetch('/api/alerts')
      ]);

      if (!membersRes.ok) {
        const err = await membersRes.json().catch(() => ({ error: 'Errore di connessione' }));
        setGlobalError(err.error || 'Errore di connessione al server');
        if (!isPolling) {
          setMembers([]);
          setActiveAttendance([]);
          setHistory([]);
          setAlerts([]);
        }
        return;
      }

      setGlobalError(null);
      setMembers(await membersRes.json());
      setActiveAttendance(await activeRes.json());
      setHistory(await historyRes.json());
      setStats(await statsRes.json());
      setDailyStats(await dailyRes.json());
      if (alertsRes && alertsRes.ok) setAlerts(await alertsRes.json());
    } catch (error: any) {
      console.error("Error fetching data:", error);
      
      // If it's a network error (Failed to fetch) during polling, just show a warning but keep data
      const isNetworkError = error.message === 'Failed to fetch' || error.name === 'TypeError';
      
      if (isNetworkError) {
        setGlobalError("Connessione al server persa. Riconnessione in corso...");
      } else {
        setGlobalError("Impossibile connettersi al server. Verifica le credenziali Firebase.");
      }
      
      if (!isPolling) {
        setMembers([]);
      }
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(() => fetchData(true), 30000); // Less frequent polling for stats
    
    // Real-time swipes via SSE
    const eventSource = new EventSource('/api/swipes/stream');
    
    eventSource.onmessage = (event) => {
      const latest = JSON.parse(event.data);
      console.log("Real-time swipe received:", latest);
      
      if (latest.card) {
        setScannedCard(latest.card);
      }

      // Update local stats/history instantly
      fetchData(true);

      if (isModalOpenRef.current) {
        // Registration phase: check if card is already registered
        // Note: we use a ref or the latest state for members here
        setMembers(prev => {
          const existingMember = prev.find(m => m.card === latest.card);
          if (existingMember) {
            setNfcMessage({ text: `Card già registrata a ${existingMember.name}`, type: 'error' });
          } else {
            setNfcMessage({ text: `Nuova card rilevata: ${latest.card}`, type: 'success' });
          }
          return prev;
        });
      } else {
        // Normal phase
        if (latest.success) {
          let msg = '';
          if (latest.action === 'checkin') msg = `${latest.memberName}: Ingresso registrato`;
          else if (latest.action === 'checkout') msg = `${latest.memberName}: Uscita registrata`;
          else if (latest.action === 'already_in') msg = `${latest.memberName}: Sei già dentro`;
          
          if (latest.usedRecovery) msg += ' (Recupero utilizzato)';
          setNfcMessage({ text: msg, type: 'success', data: latest });
        } else {
          setNfcMessage({ text: latest.error || 'Errore lettura card', type: 'error', data: latest });
        }
      }

      setTimeout(() => setNfcMessage(null), 10000);
    };

    return () => {
      clearInterval(interval);
      eventSource.close();
    };
  }, []);

  const handleCheckIn = async (memberId: string) => {
    try {
      const res = await fetch('/api/attendance/check-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ member_id: memberId })
      });
      if (res.ok) {
        fetchData();
      } else {
        const err = await res.json();
        showAlert("Errore Check-in", err.error || "Errore sconosciuto", "error");
      }
    } catch (error) {
      console.error("Check-in error:", error);
      showAlert("Errore", "Errore di connessione al server", "error");
    }
  };

  const handleCheckOut = async (attendanceId: string) => {
    try {
      const res = await fetch('/api/attendance/check-out', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attendance_id: attendanceId })
      });
      if (res.ok) fetchData();
    } catch (error) {
      console.error("Check-out error:", error);
    }
  };

  const handleResetAttendance = (memberId: string) => {
    showConfirm(
      "Reset Ingressi",
      "Sei sicuro di voler resettare tutti gli ingressi per questo iscritto? Questa azione è irreversibile.",
      async () => {
        try {
          const res = await fetch(`/api/members/${memberId}/reset-attendance`, {
            method: 'POST'
          });
          if (res.ok) {
            fetchData();
          }
        } catch (error) {
          console.error("Reset attendance error:", error);
        }
      },
      'danger'
    );
  };

  const handleResetAllAttendance = () => {
    showConfirm(
      "Reset Totale",
      "Sei sicuro di voler resettare TUTTI gli ingressi di TUTTI gli iscritti? Questa azione è irreversibile.",
      async () => {
        try {
          const res = await fetch('/api/attendance/reset-all', {
            method: 'POST'
          });
          if (res.ok) {
            fetchData();
          }
        } catch (error) {
          console.error("Reset all attendance error:", error);
        }
      },
      'danger'
    );
  };

  const handleMemberSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const data = {
      name: formData.get('name') as string,
      card: formData.get('card') as string,
      birth_date: formData.get('birth_date') as string,
      weekly_frequency: parseInt(formData.get('weekly_frequency') as string),
      price: parseFloat(formData.get('price') as string),
      email: formData.get('email') as string,
      phone: formData.get('phone') as string,
      subscription_expiry: formData.get('subscription_expiry') as string,
      available_recoveries: parseInt(formData.get('available_recoveries') as string) || 0,
    };

    try {
      const url = editingMember ? `/api/members/${editingMember.id}` : '/api/members';
      const method = editingMember ? 'PUT' : 'POST';
      
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (res.ok) {
        setIsModalOpen(false);
        isModalOpenRef.current = false;
        setEditingMember(null);
        fetchData();
      }
    } catch (error) {
      console.error("Member submit error:", error);
    }
  };

  const openAddModal = () => {
    setEditingMember(null);
    setScannedCard('');
    setIsModalOpen(true);
    isModalOpenRef.current = true;
  };

  const openEditModal = (member: Member) => {
    setEditingMember(member);
    setScannedCard('');
    setIsModalOpen(true);
    isModalOpenRef.current = true;
  };

  const handleNfcSwipe = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const card = formData.get('card') as string;
    
    try {
      const res = await fetch('/api/attendance/swipe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ card })
      });
      
      const data = await res.json();
      
      if (res.ok) {
        let msg = `${data.memberName}: ${data.action === 'checkin' ? 'Ingresso registrato' : 'Uscita registrata'}`;
        if (data.usedRecovery) {
          msg += ' (Recupero utilizzato)';
        }
        setNfcMessage({ 
          text: msg, 
          type: 'success' 
        });
        fetchData();
        setTimeout(() => {
          setNfcMessage(null);
        }, 2000);
      } else {
        setNfcMessage({ text: data.error || 'Errore lettura card', type: 'error' });
      }
    } catch (error) {
      setNfcMessage({ text: 'Errore di connessione', type: 'error' });
    }
  };

  const filteredMembers = (Array.isArray(members) ? members : []).filter(m => 
    m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    m.email?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const formatTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString();
  };

  const handleRenew = (id: string) => {
    showConfirm(
      "Rinnovo Abbonamento",
      "Sei sicuro di voler rinnovare l'abbonamento? I recuperi verranno azzerati.",
      async () => {
        try {
          const res = await fetch(`/api/members/${id}/renew`, { method: 'POST' });
          if (res.ok) {
            fetchData();
            if (selectedMember?.id === id) {
              openMemberDetails(members.find(m => m.id === id)!);
            }
          }
        } catch (error) {
          console.error("Error renewing member:", error);
        }
      }
    );
  };

  const handleDeleteMember = (id: string) => {
    showConfirm(
      "Elimina Iscritto",
      "Sei sicuro di voler eliminare questo iscritto? Questa azione è irreversibile.",
      async () => {
        try {
          const res = await fetch(`/api/members/${id}`, { method: 'DELETE' });
          if (res.ok) {
            fetchData();
            setIsMemberDetailsOpen(false);
          }
        } catch (error) {
          console.error("Error deleting member:", error);
        }
      },
      'danger'
    );
  };

  const handleResetMemberEntries = (id: string) => {
    showConfirm(
      "Reset Settimanale",
      "Vuoi resettare gli ingressi settimanali di questo utente?",
      async () => {
        try {
          const res = await fetch(`/api/members/${id}/reset`, { method: 'POST' });
          if (res.ok) {
            fetchData();
            if (selectedMember?.id === id) {
              openMemberDetails(members.find(m => m.id === id)!);
            }
          }
        } catch (error) {
          console.error("Error resetting member entries:", error);
        }
      }
    );
  };

  const handleGlobalReset = () => {
    showConfirm(
      "Reset Globale",
      "ATTENZIONE: Questa azione resetterà gli ingressi settimanali di TUTTI gli iscritti. Continuare?",
      async () => {
        try {
          const res = await fetch('/api/attendance/reset-all', { method: 'POST' });
          if (res.ok) {
            fetchData();
            showAlert("Reset Completato", "Reset globale completato con successo.", "success");
          }
        } catch (error) {
          console.error("Error in global reset:", error);
        }
      },
      'danger'
    );
  };

  const handleValidateWeekly = () => {
    const today = new Date();
    const isWeekend = [0, 6].includes(today.getDay());
    if (!isWeekend) {
      showAlert("Non Disponibile", "Questa operazione può essere eseguita solo di Sabato o Domenica.", "info");
      return;
    }

    showConfirm(
      "Validazione Settimanale",
      "Vuoi validare gli ingressi settimanali e assegnare i recuperi? Se è l'ultimo weekend del mese, i recuperi verranno azzerati.",
      async () => {
        try {
          const res = await fetch('/api/admin/validate-weekly', { method: 'POST' });
          const data = await res.json();
          if (res.ok) {
            fetchData();
            showAlert(
              "Validazione Completata", 
              data.isLastWeekend 
                ? "Validazione completata. I recuperi sono stati azzerati (fine mese)." 
                : "Validazione completata. Recuperi assegnati correttamente.", 
              "success"
            );
          } else {
            showAlert("Errore", data.error || "Errore durante la validazione.", "error");
          }
        } catch (error) {
          console.error("Error in weekly validation:", error);
        }
      }
    );
  };

  const openMemberDetails = async (member: Member) => {
    setSelectedMember(member);
    setIsMemberDetailsOpen(true);
    try {
      const res = await fetch(`/api/members/${member.id}/history`);
      if (res.ok) {
        const data = await res.json();
        setSelectedMemberHistory(data);
      }
    } catch (error) {
      console.error("Error fetching member history:", error);
    }
  };

  const handleDeleteAlert = async (id: string) => {
    try {
      const res = await fetch(`/api/alerts/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setAlerts(prev => prev.filter(a => a.id !== id));
      }
    } catch (error) {
      console.error("Error deleting alert:", error);
    }
  };

  const handleDeleteMemberAlerts = async (memberId: string) => {
    try {
      const res = await fetch(`/api/alerts/member/${memberId}`, { method: 'DELETE' });
      if (res.ok) {
        setAlerts(prev => prev.filter(a => a.member_id !== memberId));
      }
    } catch (error) {
      console.error("Error deleting member alerts:", error);
    }
  };

  const groupedAlerts = alerts.reduce((acc: any, alert: any) => {
    const memberId = alert.member_id || 'unknown';
    if (!acc[memberId]) {
      acc[memberId] = {
        name: alert.memberName || alert.member_name || 'Sconosciuto',
        member_id: memberId,
        alerts: []
      };
    }
    acc[memberId].alerts.push(alert);
    return acc;
  }, {});

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    // Simple password check for demo purposes
    if (password === 'admin123') {
      setIsAdmin(true);
      setActiveTab('dashboard');
      setLoginError(false);
    } else {
      setLoginError(true);
    }
  };

  const handleLogout = () => {
    setIsAdmin(false);
    setIsAdvancedUnlocked(false);
    setAdvancedPassword('');
    setActiveTab('kiosk');
    setPassword('');
  };

  const handleAdvancedUnlock = (e: React.FormEvent) => {
    e.preventDefault();
    if (advancedPassword === 'admin123') { // Using same password for simplicity, or could be different
      setIsAdvancedUnlocked(true);
    } else {
      showAlert("Accesso Negato", "Password errata", "error");
    }
  };

  return (
    <div className={`min-h-screen bg-[#f5f5f5] dark:bg-[#0a0a0a] text-[#1a1a1a] dark:text-[#f5f5f5] font-sans pb-24 md:pb-0 ${isAdmin ? 'md:pl-64' : ''}`}>
      {/* Sidebar / Bottom Nav - Only visible to Admin or on mobile for navigation */}
      {isAdmin && (
        <nav className="fixed bottom-0 left-0 right-0 bg-white/80 dark:bg-[#141414]/80 backdrop-blur-lg border-t dark:border-white/5 border-black/5 z-40 md:top-0 md:bottom-0 md:w-64 md:border-t-0 md:border-r md:flex md:flex-col p-2 md:p-4">
          <div className="hidden md:block mb-8 px-2">
            <h1 className="text-2xl font-bold tracking-tight text-black dark:text-white">GymFlow</h1>
            <p className="text-xs text-muted-foreground uppercase tracking-widest mt-1">Admin Panel</p>
          </div>
          
          <div className="flex justify-around md:flex-col md:gap-2 w-full">
            <NavButton 
              active={activeTab === 'dashboard'} 
              onClick={() => setActiveTab('dashboard')}
              icon={<LayoutDashboard size={20} />}
              label="Dashboard"
            />
            <NavButton 
              active={activeTab === 'members'} 
              onClick={() => setActiveTab('members')}
              icon={<Users size={20} />}
              label="Iscritti"
            />
            <NavButton 
              active={activeTab === 'history'} 
              onClick={() => setActiveTab('history')}
              icon={<History size={20} />}
              label="Storico"
            />
            <NavButton 
              active={activeTab === 'analytics'} 
              onClick={() => setActiveTab('analytics')}
              icon={<BarChart3 size={20} />}
              label="Statistiche"
            />
            <NavButton 
              active={activeTab === 'advanced'} 
              onClick={() => setActiveTab('advanced')}
              icon={<Settings size={20} />}
              label="Avanzate"
            />
            <NavButton 
              active={activeTab === 'kiosk'} 
              onClick={() => setActiveTab('kiosk')}
              icon={<Activity size={20} />}
              label="Vista Atleti"
            />
            
            <div className="mt-auto pt-4 border-t dark:border-white/5 border-black/5 flex flex-col gap-2">
              <button 
                onClick={() => setIsDarkMode(!isDarkMode)}
                className={`flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-medium transition-all ${isDarkMode ? 'bg-zinc-800 text-yellow-400 hover:bg-zinc-700' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'}`}
              >
                {isDarkMode ? <Sun size={20} /> : <Moon size={20} />}
                <span className="hidden md:inline">{isDarkMode ? 'Light Mode' : 'Dark Mode'}</span>
              </button>
              <button 
                onClick={handleLogout}
                className="flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-medium transition-all text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10"
              >
                <LogOut size={20} />
                <span className="hidden md:inline">Esci</span>
              </button>
            </div>
          </div>
        </nav>
      )}

      {/* Login Overlay for Restricted Tabs */}
      {!isAdmin && activeTab !== 'kiosk' && (
        <div className="fixed inset-0 z-50 bg-white dark:bg-[#0a0a0a] flex flex-col items-center justify-center p-6">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-md space-y-8 text-center"
          >
            <div className="space-y-2">
              <div className="w-16 h-16 md:w-20 md:h-20 bg-black dark:bg-white rounded-2xl md:rounded-3xl flex items-center justify-center mx-auto mb-6">
                <LogIn size={32} className="text-white dark:text-black md:hidden" />
                <LogIn size={40} className="text-white dark:text-black hidden md:block" />
              </div>
              <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-black dark:text-white">Area Riservata</h2>
              <p className="text-gray-500 dark:text-gray-400 text-sm md:text-base">Inserisci la password per accedere alla gestione.</p>
            </div>

            <form onSubmit={handleLogin} className="space-y-4">
              <div className="relative">
                <input 
                  type="password" 
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={`w-full px-6 py-4 bg-gray-50 rounded-2xl border ${loginError ? 'border-red-500' : 'border-black/5'} focus:outline-none focus:ring-2 focus:ring-black/5 transition-all text-black`}
                />
                {loginError && <p className="text-red-500 text-xs mt-2 font-medium">Password errata. Riprova.</p>}
              </div>
              <button 
                type="submit"
                className="w-full py-4 bg-black text-white rounded-2xl font-bold hover:bg-gray-800 transition-all shadow-lg shadow-black/10"
              >
                Accedi
              </button>
              <button 
                type="button"
                onClick={() => setActiveTab('kiosk')}
                className="w-full py-4 text-gray-400 font-medium hover:text-black transition-colors"
              >
                Torna alla Vista Atleti
              </button>
            </form>
          </motion.div>
        </div>
      )}

      {/* Main Content */}
      <main className={`${isAdmin ? 'p-4 md:p-8' : ''} max-w-5xl mx-auto`}>
        {globalError && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-2xl text-red-700 flex items-center gap-3 shadow-sm">
            <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
              <X size={16} className="text-red-600" />
            </div>
            <div>
              <h3 className="font-bold text-sm">Errore di Sistema</h3>
              <p className="text-sm opacity-90">{globalError}</p>
            </div>
          </div>
        )}

        <AnimatePresence>
          {nfcMessage && (
            <motion.div 
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className={`mb-6 p-4 rounded-2xl flex items-center justify-between shadow-lg ${nfcMessage.type === 'success' ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'}`}
            >
              <div className="flex items-center gap-3">
                {nfcMessage.type === 'success' ? <CheckCircle2 size={24} /> : <XCircle size={24} />}
                <span className="font-bold text-lg">{nfcMessage.text}</span>
              </div>
              <button onClick={() => setNfcMessage(null)} className="p-1 hover:bg-white/20 rounded-full transition-colors">
                <X size={20} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
        
        <AnimatePresence mode="wait">
          {activeTab === 'dashboard' && (
            <motion.div 
              key="dashboard"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <header className="flex justify-between items-end mb-2">
                <div>
                  <h2 className="text-3xl font-light tracking-tight">Benvenuto</h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Ecco cosa succede in palestra oggi.</p>
                </div>
                <div className="text-right flex flex-col items-end gap-2">
                  <p className="text-xs font-mono text-gray-400 uppercase tracking-tighter">{new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
                </div>
              </header>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-6">
                  {/* Subscription Warnings Banner */}
                  {alerts.filter(a => a.type === 'subscription_warning').length > 0 && (
                    <section className="bg-orange-50 dark:bg-orange-500/10 border border-orange-200 dark:border-orange-500/20 rounded-3xl p-6 shadow-sm">
                      <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 rounded-2xl bg-orange-100 dark:bg-orange-500/20 flex items-center justify-center">
                          <CalendarIcon size={20} className="text-orange-600 dark:text-orange-400" />
                        </div>
                        <div>
                          <h3 className="text-lg font-bold text-orange-900 dark:text-orange-400">Scadenze Imminenti</h3>
                          <p className="text-xs text-orange-700/60 dark:text-orange-400/60">I seguenti iscritti hanno l'abbonamento in scadenza.</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {(Array.from(new Set(alerts.filter(a => a.type === 'subscription_warning').map(a => a.member_id))) as string[]).slice(0, 4).map(mId => {
                          const alert = alerts.find(a => a.member_id === mId && a.type === 'subscription_warning');
                          const member = members.find(m => m.id === mId);
                          return (
                            <div key={mId} className="bg-white dark:bg-white/5 p-4 rounded-2xl border border-orange-100 dark:border-orange-500/20 flex items-center justify-between group">
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-full bg-orange-100 dark:bg-orange-500/20 flex items-center justify-center text-orange-700 dark:text-orange-400 font-bold text-xs">
                                  {alert.memberName?.charAt(0)}
                                </div>
                                <div>
                                  <p className="font-bold text-sm text-black dark:text-white cursor-pointer hover:underline" onClick={() => member && openMemberDetails(member)}>{alert.memberName}</p>
                                  <p className="text-[10px] text-orange-600/60 dark:text-orange-400/60">{alert.message.split('il')[1]}</p>
                                </div>
                              </div>
                              <button 
                                onClick={() => handleRenew(mId)}
                                className="opacity-0 group-hover:opacity-100 p-2 bg-orange-500 text-white rounded-xl transition-all shadow-lg shadow-orange-500/20"
                                title="Rinnova ora"
                              >
                                <RefreshCw size={14} />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  )}

                  {/* Stats Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-2 gap-3 md:gap-4">
                    <StatCard label="Ingressi" value={stats.todayCount} icon={<LogIn className="text-blue-500" />} />
                    <StatCard label="Iscritti" value={stats.totalMembers} icon={<UserPlus className="text-purple-500" />} />
                  </div>

                  {/* History Section (Moved to Home) */}
                  <section className="bg-white dark:bg-[#141414] rounded-3xl p-6 shadow-sm border border-black/5 dark:border-white/5">
                    <div className="flex justify-between items-center mb-6">
                      <h3 className="text-lg font-medium flex items-center gap-2">
                        <History size={18} className="text-blue-500" />
                        Ingressi di Oggi
                      </h3>
                      <button onClick={() => setActiveTab('history')} className="text-xs font-bold text-blue-500 hover:underline">Vedi tutto</button>
                    </div>
                    <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
                      {(() => {
                        const uniqueHistory = [];
                        const seenMembers = new Set();
                        for (const record of history) {
                          if (!seenMembers.has(record.member_id)) {
                            seenMembers.add(record.member_id);
                            uniqueHistory.push(record);
                          }
                          if (uniqueHistory.length >= 20) break;
                        }
                        return uniqueHistory.map((record) => (
                          <div key={record.id} className="flex items-center justify-between p-4 bg-gray-50 dark:bg-white/5 rounded-2xl border border-transparent hover:border-black/5 dark:hover:border-white/5 transition-all">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-full bg-black/5 dark:bg-white/10 flex items-center justify-center text-black dark:text-white font-bold text-sm">
                                {record.name.charAt(0)}
                              </div>
                              <div>
                                <p className="font-bold text-sm" onClick={() => {
                                  const m = members.find(m => m.id === record.member_id);
                                  if (m) openMemberDetails(m);
                                }} style={{ cursor: 'pointer' }}>{record.name}</p>
                                <p className="text-xs text-gray-500 dark:text-gray-400">{formatTime(record.check_in)}</p>
                              </div>
                            </div>
                            <div className="text-right">
                              <span className="px-3 py-1 bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 rounded-full text-[10px] font-bold uppercase tracking-widest">Presente</span>
                            </div>
                          </div>
                        ));
                      })()}
                      {history.length === 0 && <p className="text-center text-gray-400 py-12 italic">Nessun ingresso registrato oggi.</p>}
                    </div>
                  </section>
                </div>

                <div className="lg:col-span-1 space-y-6">
                  <div className="sticky top-4 space-y-6">
                    {/* Grouped Alerts Section */}
                    <section className="bg-white dark:bg-[#141414] rounded-3xl p-6 shadow-sm border border-black/5 dark:border-white/5">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-medium flex items-center gap-2">
                          <Activity size={18} className="text-red-500" />
                          Alert Recenti
                        </h3>
                        {alerts.length > 0 && (
                          <span className="px-2 py-0.5 bg-red-100 dark:bg-red-500/20 text-red-600 dark:text-red-400 rounded-full text-[10px] font-bold">{alerts.length}</span>
                        )}
                      </div>
                      <div className="space-y-4 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
                        {Object.values(groupedAlerts).map((group: any) => (
                          <div key={group.member_id} className="p-4 bg-red-50/50 dark:bg-red-500/5 rounded-2xl border border-red-100 dark:border-red-500/20 space-y-3">
                            <div className="flex justify-between items-center">
                              <p className="font-bold text-sm text-red-900 dark:text-red-400" onClick={() => {
                                const m = members.find(m => m.id === group.member_id);
                                if (m) openMemberDetails(m);
                              }} style={{ cursor: 'pointer' }}>{group.name}</p>
                              <button 
                                onClick={() => handleDeleteMemberAlerts(group.member_id)}
                                className="text-[10px] font-bold text-red-500 hover:underline"
                              >
                                Elimina tutti
                              </button>
                            </div>
                            <div className="space-y-2">
                              {group.alerts.map((alert: any) => (
                                <div key={alert.id} className="flex justify-between items-start gap-2 text-xs bg-white dark:bg-white/5 p-2 rounded-xl border border-red-100 dark:border-red-500/20">
                                  <div className="space-y-1">
                                    <p className="text-red-700 dark:text-red-300">{alert.message}</p>
                                    <p className="text-[10px] text-gray-400">{new Date(alert.timestamp?._seconds * 1000 || alert.timestamp).toLocaleString('it-IT')}</p>
                                  </div>
                                  <button 
                                    onClick={() => handleDeleteAlert(alert.id)}
                                    className="p-1 hover:bg-red-50 dark:hover:bg-white/10 rounded-full text-red-300 hover:text-red-500"
                                  >
                                    <X size={14} />
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                        {alerts.length === 0 && (
                          <div className="text-center py-12 space-y-3">
                            <div className="w-12 h-12 bg-gray-50 dark:bg-white/5 rounded-full flex items-center justify-center mx-auto">
                              <CheckCircle2 size={24} className="text-gray-200 dark:text-gray-700" />
                            </div>
                            <p className="text-gray-400 text-sm italic">Nessun alert attivo.</p>
                          </div>
                        )}
                      </div>
                    </section>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'analytics' && (
            <motion.div 
              key="analytics"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-8"
            >
              <header>
                <h2 className="text-3xl font-light tracking-tight">Statistiche</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">Analisi dell'andamento e presenze in palestra.</p>
              </header>

              <section className="bg-white dark:bg-[#141414] rounded-3xl p-8 shadow-sm border border-black/5 dark:border-white/5">
                <h3 className="text-xl font-bold mb-8">Andamento Presenze (Ultimi 30gg)</h3>
                <div className="h-80 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={[...dailyStats].reverse()}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={isDarkMode ? "#333" : "#f0f0f0"} />
                      <XAxis 
                        dataKey="date" 
                        fontSize={10} 
                        tickFormatter={(str) => new Date(str).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })}
                        axisLine={false}
                        tickLine={false}
                        stroke={isDarkMode ? "#666" : "#999"}
                      />
                      <YAxis axisLine={false} tickLine={false} fontSize={10} stroke={isDarkMode ? "#666" : "#999"} />
                      <Tooltip 
                        contentStyle={{ 
                          borderRadius: '16px', 
                          border: 'none', 
                          boxShadow: '0 10px 25px -5px rgb(0 0 0 / 0.1)',
                          backgroundColor: isDarkMode ? '#1a1a1a' : '#fff',
                          color: isDarkMode ? '#fff' : '#000'
                        }}
                        itemStyle={{ color: isDarkMode ? '#fff' : '#000' }}
                      />
                      <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                        {dailyStats.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={new Date(entry.date).toDateString() === new Date().toDateString() ? '#10b981' : (isDarkMode ? '#fff' : '#1a1a1a')} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </section>

              <section className="space-y-4">
                <h3 className="text-xl font-bold px-2">Calendario Presenze</h3>
                <Calendar dailyStats={dailyStats} onDayClick={handleDayClick} />
              </section>
            </motion.div>
          )}

          {activeTab === 'members' && (
            <motion.div 
              key="members"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <h2 className="text-3xl font-light tracking-tight">Iscritti</h2>
                <button 
                  onClick={openAddModal}
                  className="flex items-center justify-center gap-2 px-6 py-3 bg-black dark:bg-white dark:text-black text-white rounded-2xl font-medium hover:bg-gray-800 dark:hover:bg-gray-200 transition-all shadow-lg shadow-black/10"
                >
                  <Plus size={20} />
                  Nuovo Iscritto
                </button>
              </div>

              <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                <input 
                  type="text" 
                  placeholder="Cerca per nome o email..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-12 pr-4 py-4 bg-white dark:bg-[#141414] rounded-2xl border border-black/5 dark:border-white/5 focus:outline-none focus:ring-2 focus:ring-black/5 transition-all shadow-sm"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredMembers.map((member) => {
                  const isActive = activeAttendance.some(a => a.member_id === member.id);
                  return (
                    <div key={member.id} className="bg-white dark:bg-[#141414] p-5 rounded-3xl border border-black/5 dark:border-white/5 shadow-sm hover:shadow-md transition-all group">
                      <div className="flex justify-between items-start mb-3 md:mb-4">
                        <div className="flex items-center gap-2 md:gap-3">
                          <div 
                            className="w-10 h-10 md:w-12 md:h-12 rounded-xl md:rounded-2xl bg-gray-100 dark:bg-white/10 flex items-center justify-center text-gray-500 dark:text-gray-400 font-bold text-base md:text-lg cursor-pointer hover:bg-gray-200 dark:hover:bg-white/20 transition-colors"
                            onClick={() => openMemberDetails(member)}
                          >
                            {member.name.charAt(0)}
                          </div>
                          <div>
                            <h4 
                              className="font-bold text-base md:text-lg cursor-pointer hover:underline"
                              onClick={() => openMemberDetails(member)}
                            >
                              {member.name}
                            </h4>
                            <div className="flex flex-wrap gap-x-2 gap-y-1 mt-0.5">
                              <p className="text-[9px] md:text-[10px] text-gray-400 font-mono uppercase tracking-tighter flex items-center gap-1">
                                <CreditCard size={10} /> {member.card || 'No Card'}
                              </p>
                              <p className="text-[9px] md:text-[10px] text-gray-400 font-mono uppercase tracking-tighter flex items-center gap-1">
                                <Activity size={10} /> {member.weekly_frequency}gg
                              </p>
                              {member.subscription_expiry && (
                                <p className={`text-[9px] md:text-[10px] font-mono uppercase tracking-tighter flex items-center gap-1 ${new Date(member.subscription_expiry) < new Date() ? 'text-red-500 font-bold' : 'text-gray-400'}`}>
                                  <CalendarDays size={10} /> {new Date(member.subscription_expiry).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' })}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1.5 md:gap-2">
                          {isActive ? (
                            <span className="flex items-center gap-1 text-[9px] md:text-[10px] font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10 px-2 py-0.5 md:py-1 rounded-full uppercase tracking-wider">
                              <div className="w-1 h-1 md:w-1.5 md:h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                              In sala
                            </span>
                          ) : (
                            <span className="text-[9px] md:text-[10px] font-bold text-gray-400 bg-gray-50 dark:bg-white/5 px-2 py-0.5 md:py-1 rounded-full uppercase tracking-wider">
                              Assente
                            </span>
                          )}
                        </div>
                      </div>
                      
                      <div className="flex items-center justify-between gap-2 mt-3 md:mt-4">
                        <div className="flex items-center gap-1">
                          <button 
                            onClick={() => handleRenew(member.id)}
                            title="Rinnova Mese"
                            className="p-2 text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 rounded-lg transition-all"
                          >
                            <CalendarIcon size={16} />
                          </button>
                          <button 
                            onClick={() => openEditModal(member)}
                            title="Modifica"
                            className="p-2 text-gray-400 hover:text-black dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/5 rounded-lg transition-all"
                          >
                            <Edit2 size={16} />
                          </button>
                          <button 
                            onClick={() => handleResetMemberEntries(member.id)}
                            title="Reset Ingressi"
                            className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-all"
                          >
                            <History size={16} />
                          </button>
                        </div>

                        <div className="flex-1 max-w-[120px]">
                          {!isActive ? (
                            <button 
                              onClick={() => handleCheckIn(member.id)}
                              className="w-full flex items-center justify-center gap-1.5 py-2 bg-emerald-500 text-white rounded-lg font-bold hover:bg-emerald-600 transition-colors shadow-md shadow-emerald-500/20 text-xs"
                            >
                              <LogIn size={14} />
                              Check-in
                            </button>
                          ) : (
                            <button 
                              disabled
                              className="w-full flex items-center justify-center gap-1.5 py-2 bg-gray-100 dark:bg-white/5 text-gray-400 rounded-lg font-bold cursor-not-allowed text-xs"
                            >
                              <CheckCircle2 size={14} />
                              In sala
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          )}

          {activeTab === 'history' && (
            <motion.div 
              key="history"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <h2 className="text-3xl font-light tracking-tight">Storico Ingressi</h2>
                <button 
                  onClick={handleGlobalReset}
                  className="flex items-center justify-center gap-2 px-4 py-2 bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 rounded-xl font-medium hover:bg-red-100 dark:hover:bg-red-500/20 transition-all border border-red-100 dark:border-red-500/20"
                >
                  <History size={18} />
                  Reset Tutto
                </button>
              </div>
              
              <div className="bg-white dark:bg-[#141414] rounded-3xl overflow-hidden border border-black/5 dark:border-white/5 shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="bg-gray-50 dark:bg-white/5 border-bottom border-black/5 dark:border-white/5">
                        <th className="px-4 md:px-6 py-4 text-[10px] md:text-xs font-bold text-gray-400 uppercase tracking-widest">Iscritto</th>
                        <th className="px-4 md:px-6 py-4 text-[10px] md:text-xs font-bold text-gray-400 uppercase tracking-widest">Data</th>
                        <th className="px-4 md:px-6 py-4 text-[10px] md:text-xs font-bold text-gray-400 uppercase tracking-widest">Entrata</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-black/5 dark:divide-white/5">
                      {history.map((record) => {
                        return (
                          <tr key={record.id} className="hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
                            <td className="px-4 md:px-6 py-4 text-sm font-medium cursor-pointer hover:underline" onClick={() => {
                              const m = members.find(m => m.id === record.member_id);
                              if (m) openMemberDetails(m);
                            }}>{record.name}</td>
                            <td className="px-4 md:px-6 py-4 text-xs md:text-sm text-gray-500 dark:text-gray-400">{formatDate(record.check_in)}</td>
                            <td className="px-4 md:px-6 py-4 text-xs md:text-sm font-mono">{formatTime(record.check_in)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'advanced' && (
            <motion.div 
              key="advanced"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="max-w-2xl mx-auto space-y-8"
            >
              <header>
                <h2 className="text-3xl font-light tracking-tight">Avanzate</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">Operazioni critiche di sistema.</p>
              </header>

              {!isAdvancedUnlocked ? (
                <section className="bg-white dark:bg-zinc-900 rounded-[2.5rem] p-8 md:p-12 shadow-2xl border border-black/5 dark:border-white/5 text-center space-y-6 md:space-y-8">
                  <div className="w-16 h-16 md:w-20 md:h-20 bg-red-50 dark:bg-red-500/10 rounded-2xl md:rounded-3xl flex items-center justify-center mx-auto rotate-3">
                    <Lock size={32} className="text-red-500 md:hidden" />
                    <Lock size={40} className="text-red-500 hidden md:block" />
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-xl md:text-2xl font-bold text-black dark:text-white">Area Protetta</h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Inserisci la password amministratore per accedere alle funzioni avanzate.</p>
                  </div>
                  <form onSubmit={handleAdvancedUnlock} className="flex flex-col gap-4 max-w-xs mx-auto">
                    <input 
                      type="password" 
                      placeholder="Password"
                      value={advancedPassword}
                      onChange={(e) => setAdvancedPassword(e.target.value)}
                      className="w-full px-6 py-4 bg-gray-100 dark:bg-zinc-800 rounded-2xl border-2 border-transparent focus:border-black dark:focus:border-white focus:outline-none transition-all text-center text-lg font-bold tracking-widest text-black dark:text-white"
                    />
                    <button type="submit" className="w-full py-4 bg-black dark:bg-white dark:text-black text-white rounded-2xl font-bold text-lg hover:scale-[1.02] active:scale-[0.98] transition-all">Sblocca</button>
                  </form>
                </section>
              ) : (
                <div className="space-y-6">
                  <section className="bg-white dark:bg-zinc-900 rounded-[2.5rem] p-6 md:p-8 shadow-sm border border-black/5 dark:border-white/5 space-y-6 md:space-y-8">
                    <div className="flex items-center gap-4 md:gap-6">
                      <div className="w-12 h-12 md:w-14 md:h-14 bg-blue-50 dark:bg-blue-500/10 rounded-xl md:rounded-2xl flex items-center justify-center">
                        <CheckCircle2 size={24} className="text-blue-500 md:hidden" />
                        <CheckCircle2 size={28} className="text-blue-500 hidden md:block" />
                      </div>
                      <div className="flex-1">
                        <h3 className="text-lg md:text-xl font-bold">Validazione Settimanale</h3>
                        <p className="text-xs md:text-sm text-gray-500 dark:text-gray-400">Valida gli ingressi della settimana e assegna i recuperi. Disponibile Sabato e Domenica.</p>
                      </div>
                    </div>
                    <button 
                      onClick={handleValidateWeekly}
                      disabled={![0, 6].includes(new Date().getDay())}
                      className={`w-full py-5 rounded-2xl font-bold text-lg transition-all shadow-xl ${
                        [0, 6].includes(new Date().getDay()) 
                          ? 'bg-blue-500 text-white hover:bg-blue-600 shadow-blue-500/20' 
                          : 'bg-gray-100 dark:bg-zinc-800 text-gray-400 cursor-not-allowed opacity-50'
                      }`}
                    >
                      {[0, 6].includes(new Date().getDay()) ? 'Esegui Validazione Settimanale' : 'Disponibile Sabato/Domenica'}
                    </button>
                  </section>

                  <section className="bg-white dark:bg-zinc-900 rounded-[2.5rem] p-6 md:p-8 shadow-sm border border-black/5 dark:border-white/5 space-y-6 md:space-y-8">
                    <div className="flex items-center gap-4 md:gap-6">
                      <div className="w-12 h-12 md:w-14 md:h-14 bg-red-50 dark:bg-red-500/10 rounded-xl md:rounded-2xl flex items-center justify-center">
                        <RefreshCw size={24} className="text-red-500 md:hidden" />
                        <RefreshCw size={28} className="text-red-500 hidden md:block" />
                      </div>
                      <div className="flex-1">
                        <h3 className="text-lg md:text-xl font-bold">Reset Globale Ingressi</h3>
                        <p className="text-xs md:text-sm text-gray-500 dark:text-gray-400">Azzera il conteggio degli ingressi settimanali per tutti gli iscritti.</p>
                      </div>
                    </div>
                    <button 
                      onClick={handleGlobalReset}
                      className="w-full py-5 bg-red-500 text-white rounded-2xl font-bold text-lg hover:bg-red-600 transition-all shadow-xl shadow-red-500/20"
                    >
                      Esegui Reset Globale
                    </button>
                  </section>
                </div>
              )}
            </motion.div>
          )}

          {activeTab === 'kiosk' && (
            <motion.div 
              key="kiosk"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.05 }}
              className="fixed inset-0 z-50 bg-black flex flex-col items-center justify-center p-6 text-white overflow-hidden"
            >
              {!isAdmin && (
                <button 
                  onClick={() => setActiveTab('dashboard')}
                  className="absolute top-8 right-8 p-3 bg-white/10 hover:bg-white/20 rounded-full transition-colors flex items-center gap-2 text-xs font-bold uppercase tracking-widest"
                >
                  <LogIn size={16} />
                  Admin
                </button>
              )}

              {isAdmin && (
                <button 
                  onClick={() => setActiveTab('dashboard')}
                  className="absolute top-8 left-8 p-3 bg-white/10 hover:bg-white/20 rounded-full transition-colors"
                >
                  <ChevronLeft size={24} />
                </button>
              )}

              <div className="text-center space-y-6 md:space-y-8 max-w-3xl w-full px-4">
                {!nfcMessage ? (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="space-y-4 md:space-y-6"
                  >
                    <div className="w-24 h-24 md:w-32 md:h-32 bg-white/5 rounded-full flex items-center justify-center mx-auto animate-pulse">
                      <CreditCard size={48} className="text-white/20 md:hidden" />
                      <CreditCard size={64} className="text-white/20 hidden md:block" />
                    </div>
                    <h2 className="text-3xl md:text-4xl font-bold tracking-tight">Passa la tua Card</h2>
                    <p className="text-lg md:text-xl text-white/40">Avvicina la card al lettore per entrare</p>
                  </motion.div>
                ) : (
                  <motion.div 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-6 md:space-y-10"
                  >
                    <div className={`w-32 h-32 md:w-40 md:h-40 rounded-full flex items-center justify-center mx-auto shadow-2xl ${nfcMessage.type === 'success' ? 'bg-emerald-500 shadow-emerald-500/40' : 'bg-red-500 shadow-red-500/40'}`}>
                      {nfcMessage.type === 'success' ? <CheckCircle2 size={60} className="md:hidden" /> : <XCircle size={60} className="md:hidden" />}
                      {nfcMessage.type === 'success' ? <CheckCircle2 size={80} className="hidden md:block" /> : <XCircle size={80} className="hidden md:block" />}
                    </div>

                    <div className="space-y-2 md:space-y-3">
                      <h2 className="text-4xl md:text-6xl font-black tracking-tighter uppercase truncate px-2 md:px-4">
                        {nfcMessage.data?.memberName || (nfcMessage.type === 'success' ? 'BENVENUTO' : 'ATTENZIONE')}
                      </h2>
                      <p className={`text-xl md:text-3xl font-bold ${nfcMessage.type === 'success' ? 'text-emerald-400' : 'text-red-400'}`}>
                        {nfcMessage.text.split(':')[1] || nfcMessage.text}
                      </p>
                    </div>

                    {nfcMessage.data && (
                      <div className="space-y-6 md:space-y-8 pt-6 md:pt-8 border-t border-white/10">
                        {/* Weekly Attendance Dots */}
                        <div className="space-y-3 md:space-y-4">
                          <p className="text-[10px] md:text-xs font-bold text-white/40 uppercase tracking-widest">Presenze Settimanali</p>
                          <div className="flex justify-center gap-2 md:gap-3">
                            {['L', 'M', 'M', 'G', 'V', 'S', 'D'].map((day, index) => {
                              const dayNum = (index + 1) % 7; // 1=Mon, ..., 6=Sat, 0=Sun
                              const attended = nfcMessage.data.weeklyDays?.includes(dayNum);
                              const isToday = new Date().getDay() === dayNum;
                              return (
                                <div key={index} className="flex flex-col items-center gap-1 md:gap-2">
                                  <div className={`w-10 h-10 md:w-12 md:h-12 rounded-full flex items-center justify-center text-base md:text-lg font-bold transition-all border-2 ${attended ? 'bg-emerald-500 border-emerald-400 shadow-lg shadow-emerald-500/20' : isToday ? 'border-white/40 bg-white/10' : 'bg-white/5 border-white/10 text-white/20'}`}>
                                    {attended ? <Check size={18} /> : day}
                                  </div>
                                  <span className={`text-[7px] md:text-[8px] font-bold uppercase ${isToday ? 'text-white' : 'text-white/20'}`}>{['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'][index]}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        <div className="grid grid-cols-3 gap-2 md:gap-4">
                          <div className="bg-white/5 p-3 md:p-4 rounded-2xl md:rounded-[2rem] text-left border border-white/5">
                            <p className="text-[8px] md:text-[10px] font-bold text-white/40 uppercase tracking-widest mb-1">Frequenza</p>
                            <div className="flex items-end gap-0.5 md:gap-1">
                              <span className="text-2xl md:text-3xl font-black">{nfcMessage.data.weeklyCount || 0}</span>
                              <span className="text-sm md:text-lg text-white/40 mb-0.5">/ {nfcMessage.data.weeklyFrequency || '/'}</span>
                            </div>
                          </div>
                          <div className="bg-white/5 p-3 md:p-4 rounded-2xl md:rounded-[2rem] text-left border border-white/5">
                            <p className="text-[8px] md:text-[10px] font-bold text-white/40 uppercase tracking-widest mb-1">Recuperi</p>
                            <div className="flex items-end gap-0.5 md:gap-1">
                              <span className="text-2xl md:text-3xl font-black text-blue-400">{nfcMessage.data.availableRecoveries || 0}</span>
                            </div>
                          </div>
                          <div className={`p-3 md:p-4 rounded-2xl md:rounded-[2rem] text-left border ${
                            nfcMessage.data.expiryDate && new Date(nfcMessage.data.expiryDate) < new Date() 
                              ? 'bg-red-500/10 border-red-500/20' 
                              : nfcMessage.data.expiryDate && (new Date(nfcMessage.data.expiryDate).getTime() - new Date().getTime()) < (3 * 24 * 60 * 60 * 1000)
                                ? 'bg-orange-500/10 border-orange-500/20'
                                : 'bg-white/5 border-white/5'
                          }`}>
                            <p className="text-[8px] md:text-[10px] font-bold text-white/40 uppercase tracking-widest mb-1">Scadenza</p>
                            <div className="flex items-center gap-1 md:gap-2">
                              <span className={`text-base md:text-xl font-bold ${
                                !nfcMessage.data.expiryDate || isNaN(new Date(nfcMessage.data.expiryDate).getTime())
                                  ? 'text-white/20'
                                  : nfcMessage.data.expiryDate && new Date(nfcMessage.data.expiryDate) < new Date() 
                                    ? 'text-red-500' 
                                    : nfcMessage.data.expiryDate && (new Date(nfcMessage.data.expiryDate).getTime() - new Date().getTime()) < (3 * 24 * 60 * 60 * 1000)
                                      ? 'text-orange-500'
                                      : ''
                              }`}>
                                {!nfcMessage.data.expiryDate || isNaN(new Date(nfcMessage.data.expiryDate).getTime()) 
                                  ? '/' 
                                  : new Date(nfcMessage.data.expiryDate).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' })}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Auto-reset progress bar */}
                    <div className="absolute bottom-0 left-0 h-1 bg-white/20 w-full overflow-hidden">
                      <motion.div 
                        initial={{ width: '100%' }}
                        animate={{ width: '0%' }}
                        transition={{ duration: 10, ease: 'linear' }}
                        className="h-full bg-white/40"
                      />
                    </div>
                  </motion.div>
                )}
              </div>

              <div className="absolute bottom-12 text-white/10 font-mono text-[10px] tracking-[0.3em] uppercase">
                GymFlow Kiosk System v2.1 • Smart Attendance
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Member Details Modal */}
      <AnimatePresence>
        {isMemberDetailsOpen && selectedMember && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsMemberDetailsOpen(false)}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-2xl bg-white dark:bg-[#141414] rounded-t-[2rem] md:rounded-[2rem] p-6 md:p-10 shadow-2xl overflow-y-auto max-h-[95vh] md:max-h-[90vh] mt-auto md:mt-0"
            >
              <div className="flex justify-between items-start mb-6 md:mb-8">
                <div className="flex items-center gap-4 md:gap-6">
                  <div className="w-16 h-16 md:w-20 md:h-20 rounded-2xl md:rounded-3xl bg-black dark:bg-white text-white dark:text-black flex items-center justify-center text-2xl md:text-3xl font-bold">
                    {selectedMember.name.charAt(0)}
                  </div>
                  <div>
                    <h3 className="text-2xl md:text-3xl font-bold">{selectedMember.name}</h3>
                    <p className="text-gray-500 dark:text-gray-400 flex items-center gap-2 mt-1 text-sm">
                      <CreditCard size={14} /> {selectedMember.card || 'Nessuna Card'}
                    </p>
                  </div>
                </div>
                <button onClick={() => setIsMemberDetailsOpen(false)} className="p-2 hover:bg-gray-100 dark:hover:bg-white/5 rounded-full transition-colors">
                  <X size={24} />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                <div className="p-4 bg-gray-50 dark:bg-white/5 rounded-2xl border border-black/5 dark:border-white/5">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Stato</p>
                  <div className="flex items-center gap-2">
                    {selectedMember.subscription_expiry && new Date(selectedMember.subscription_expiry) < new Date() ? (
                      <span className="text-red-500 font-bold flex items-center gap-1"><XCircle size={16} /> Scaduto</span>
                    ) : (
                      <span className="text-emerald-500 font-bold flex items-center gap-1"><CheckCircle2 size={16} /> A Regola</span>
                    )}
                  </div>
                </div>
                <div className="p-4 bg-gray-50 dark:bg-white/5 rounded-2xl border border-black/5 dark:border-white/5">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Ingressi Settimanali</p>
                  <p className="text-2xl font-black">{selectedMember.weeklyCount || 0} / {selectedMember.weekly_frequency}</p>
                </div>
                <div className="p-4 bg-gray-50 dark:bg-white/5 rounded-2xl border border-black/5 dark:border-white/5">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Recuperi</p>
                  <p className="text-2xl font-black text-blue-500">{selectedMember.available_recoveries || 0}</p>
                </div>
              </div>

              {/* Weekly Dots in Details Modal */}
              <div className="mb-8 p-6 bg-gray-50 dark:bg-white/5 rounded-3xl border border-black/5 dark:border-white/5">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-4 text-center">Presenze Settimanali (Lun - Ven)</p>
                <div className="flex justify-center gap-4">
                  {['L', 'M', 'M', 'G', 'V'].map((day, index) => {
                    const dayNum = index + 1; // 1=Mon, 2=Tue, etc.
                    const attended = selectedMember.weeklyDays?.includes(dayNum);
                    const isToday = new Date().getDay() === dayNum;
                    return (
                      <div key={index} className="flex flex-col items-center gap-2">
                        <div className={`w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold transition-all border-2 ${attended ? 'bg-emerald-500 border-emerald-400 text-white shadow-lg shadow-emerald-500/20' : isToday ? 'border-black dark:border-white bg-black/5 dark:bg-white/10' : 'bg-white dark:bg-white/5 border-black/5 dark:border-white/5 text-gray-300 dark:text-gray-600'}`}>
                          {attended ? <Check size={20} /> : day}
                        </div>
                        <span className={`text-[9px] font-bold uppercase ${isToday ? 'text-black dark:text-white' : 'text-gray-400'}`}>{['Lun', 'Mar', 'Mer', 'Gio', 'Ven'][index]}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h4 className="text-xl font-bold flex items-center gap-2">
                    <History size={20} className="text-gray-400" />
                    Storico Ingressi
                  </h4>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => handleResetMemberEntries(selectedMember.id)}
                      className="px-4 py-2 bg-red-50 dark:bg-red-500/10 text-red-600 rounded-xl text-xs font-bold"
                    >
                      Reset Settimana
                    </button>
                    <button 
                      onClick={() => handleRenew(selectedMember.id)}
                      className="px-4 py-2 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 rounded-xl text-xs font-bold"
                    >
                      Rinnova Mese
                    </button>
                  </div>
                </div>

                <div className="space-y-3">
                  {selectedMemberHistory.length === 0 ? (
                    <p className="text-center text-gray-400 py-8 italic">Nessuno storico disponibile.</p>
                  ) : (
                    selectedMemberHistory.map(record => (
                      <div key={record.id} className="flex items-center justify-between p-4 bg-gray-50 dark:bg-white/5 rounded-2xl border border-transparent">
                        <div>
                          <p className="font-bold text-sm">{new Date(record.check_in).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">{new Date(record.check_in).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</p>
                        </div>
                        <span className="px-3 py-1 bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 rounded-full text-[10px] font-bold uppercase">Ingresso</span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="mt-8 pt-8 border-t dark:border-white/5 border-black/5">
                <button 
                  onClick={() => handleDeleteMember(selectedMember.id)}
                  className="w-full py-4 bg-red-50 dark:bg-red-500/10 text-red-600 rounded-2xl font-bold hover:bg-red-100 dark:hover:bg-red-500/20 transition-all flex items-center justify-center gap-2"
                >
                  <Trash2 size={20} />
                  Elimina Iscritto
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Member Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => { setIsModalOpen(false); isModalOpenRef.current = false; setEditingMember(null); setScannedCard(''); }}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-lg bg-white dark:bg-[#141414] rounded-t-[2rem] md:rounded-[2rem] p-6 md:p-8 shadow-2xl overflow-y-auto max-h-[95vh] md:max-h-[90vh] mt-auto md:mt-0"
            >
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-2xl font-bold">{editingMember ? 'Modifica Iscritto' : 'Nuovo Iscritto'}</h3>
                <button onClick={() => { setIsModalOpen(false); isModalOpenRef.current = false; setEditingMember(null); setScannedCard(''); }} className="p-2 hover:bg-gray-100 dark:hover:bg-white/5 rounded-full transition-colors">
                  <X size={24} />
                </button>
              </div>
              
              <form onSubmit={handleMemberSubmit} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-1 ml-1">Nome e Cognome</label>
                    <input 
                      name="name" 
                      required 
                      defaultValue={editingMember?.name}
                      className="w-full px-4 py-3 bg-gray-50 dark:bg-white/5 rounded-xl border border-transparent focus:bg-white dark:focus:bg-white/10 focus:border-black/10 dark:focus:border-white/10 focus:outline-none transition-all"
                      placeholder="Mario Rossi"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-1 ml-1">Card ID</label>
                    <input 
                      name="card" 
                      defaultValue={editingMember?.card || scannedCard}
                      key={editingMember?.card || scannedCard}
                      className="w-full px-4 py-3 bg-gray-50 dark:bg-white/5 rounded-xl border border-transparent focus:bg-white dark:focus:bg-white/10 focus:border-black/10 dark:focus:border-white/10 focus:outline-none transition-all"
                      placeholder="123456"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-1 ml-1">Frequenza (1-5 GG)</label>
                    <select 
                      name="weekly_frequency" 
                      defaultValue={editingMember?.weekly_frequency || 3}
                      className="w-full px-4 py-3 bg-gray-50 dark:bg-white/5 rounded-xl border border-transparent focus:bg-white dark:focus:bg-white/10 focus:border-black/10 dark:focus:border-white/10 focus:outline-none transition-all"
                    >
                      {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n} Giorni</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-1 ml-1">Prezzo (€)</label>
                    <input 
                      name="price" 
                      type="number"
                      step="0.01"
                      defaultValue={editingMember?.price}
                      className="w-full px-4 py-3 bg-gray-50 dark:bg-white/5 rounded-xl border border-transparent focus:bg-white dark:focus:bg-white/10 focus:border-black/10 dark:focus:border-white/10 focus:outline-none transition-all"
                      placeholder="50.00"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-1 ml-1">Scadenza Abbonamento</label>
                    <input 
                      name="subscription_expiry" 
                      type="date"
                      defaultValue={editingMember?.subscription_expiry ? new Date(editingMember.subscription_expiry).toISOString().split('T')[0] : ''}
                      className="w-full px-4 py-3 bg-gray-50 dark:bg-white/5 rounded-xl border border-transparent focus:bg-white dark:focus:bg-white/10 focus:border-black/10 dark:focus:border-white/10 focus:outline-none transition-all"
                    />
                  </div>
                </div>
                <button 
                  type="submit"
                  className="w-full py-4 bg-black dark:bg-white dark:text-black text-white rounded-2xl font-bold text-lg hover:bg-gray-800 dark:hover:bg-gray-200 transition-all shadow-xl shadow-black/20 mt-4"
                >
                  {editingMember ? 'Salva Modifiche' : 'Registra Iscritto'}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <ConfirmModal 
        isOpen={confirmDialog.isOpen}
        title={confirmDialog.title}
        message={confirmDialog.message}
        onConfirm={confirmDialog.onConfirm}
        onClose={() => setConfirmDialog(prev => ({ ...prev, isOpen: false }))}
        type={confirmDialog.type}
      />

      <AlertModal 
        isOpen={alertDialog.isOpen}
        title={alertDialog.title}
        message={alertDialog.message}
        onClose={() => setAlertDialog(prev => ({ ...prev, isOpen: false }))}
        type={alertDialog.type}
      />

      {/* Day History Modal */}
      <AnimatePresence>
        {isDayHistoryOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsDayHistoryOpen(false)}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-xl bg-white dark:bg-[#141414] rounded-[2rem] p-8 shadow-2xl overflow-y-auto max-h-[80vh]"
            >
              <div className="flex justify-between items-center mb-8">
                <h3 className="text-2xl font-bold">Ingressi del {selectedDateLabel}</h3>
                <button onClick={() => setIsDayHistoryOpen(false)} className="p-2 hover:bg-gray-100 dark:hover:bg-white/5 rounded-full transition-colors">
                  <X size={24} />
                </button>
              </div>

              <div className="space-y-3">
                {selectedDayHistory.map((record) => (
                  <div key={record.id} className="flex items-center justify-between p-4 bg-gray-50 dark:bg-white/5 rounded-2xl border border-black/5 dark:border-white/5">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-black dark:bg-white text-white dark:text-black flex items-center justify-center font-bold text-sm">
                        {record.name.charAt(0)}
                      </div>
                      <div>
                        <p className="font-bold text-sm">{record.name}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {formatTime(record.check_in)} 
                          {record.check_out && ` - ${formatTime(record.check_out)}`}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="px-3 py-1 bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 rounded-full text-[10px] font-bold uppercase tracking-widest">Presente</span>
                    </div>
                  </div>
                ))}
                {selectedDayHistory.length === 0 && (
                  <div className="text-center py-12">
                    <History size={48} className="mx-auto text-gray-200 dark:text-gray-800 mb-4" />
                    <p className="text-gray-400 italic">Nessun ingresso registrato in questa data.</p>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ConfirmModal({ 
  isOpen, 
  title, 
  message, 
  onConfirm, 
  onClose, 
  type = 'info' 
}: { 
  isOpen: boolean, 
  title: string, 
  message: string, 
  onConfirm: () => void, 
  onClose: () => void,
  type?: 'danger' | 'info'
}) {
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
          />
          <motion.div 
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="relative w-full max-w-md bg-white dark:bg-[#141414] rounded-3xl p-6 shadow-2xl"
          >
            <div className="flex items-center gap-4 mb-4">
              <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${type === 'danger' ? 'bg-red-50 dark:bg-red-500/10 text-red-500' : 'bg-blue-50 dark:bg-blue-500/10 text-blue-500'}`}>
                {type === 'danger' ? <Trash2 size={24} /> : <Activity size={24} />}
              </div>
              <h3 className="text-xl font-bold">{title}</h3>
            </div>
            <p className="text-gray-500 dark:text-gray-400 mb-8">{message}</p>
            <div className="flex gap-3">
              <button 
                onClick={onClose}
                className="flex-1 py-3 bg-gray-100 dark:bg-white/5 rounded-xl font-bold hover:bg-gray-200 dark:hover:bg-white/10 transition-all"
              >
                Annulla
              </button>
              <button 
                onClick={() => { onConfirm(); onClose(); }}
                className={`flex-1 py-3 rounded-xl font-bold text-white transition-all ${type === 'danger' ? 'bg-red-500 hover:bg-red-600' : 'bg-black dark:bg-white dark:text-black hover:bg-gray-800 dark:hover:bg-gray-200'}`}
              >
                Conferma
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

function AlertModal({ 
  isOpen, 
  title, 
  message, 
  onClose,
  type = 'info'
}: { 
  isOpen: boolean, 
  title: string, 
  message: string, 
  onClose: () => void,
  type?: 'success' | 'error' | 'info'
}) {
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
          />
          <motion.div 
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="relative w-full max-w-md bg-white dark:bg-[#141414] rounded-3xl p-6 shadow-2xl text-center"
          >
            <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 ${
              type === 'success' ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-500' : 
              type === 'error' ? 'bg-red-50 dark:bg-red-500/10 text-red-500' : 
              'bg-blue-50 dark:bg-blue-500/10 text-blue-500'
            }`}>
              {type === 'success' ? <CheckCircle2 size={32} /> : 
               type === 'error' ? <XCircle size={32} /> : 
               <Activity size={32} />}
            </div>
            <h3 className="text-xl font-bold mb-2">{title}</h3>
            <p className="text-gray-500 dark:text-gray-400 mb-8">{message}</p>
            <button 
              onClick={onClose}
              className="w-full py-3 bg-black dark:bg-white dark:text-black text-white rounded-xl font-bold hover:bg-gray-800 dark:hover:bg-gray-200 transition-all"
            >
              OK
            </button>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

function Calendar({ dailyStats, onDayClick }: { dailyStats: {date: string, count: number}[], onDayClick: (date: string) => void }) {
  const [currentMonth, setCurrentMonth] = useState(new Date());

  const daysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
  const firstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay();

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const days = daysInMonth(year, month);
  const firstDay = (firstDayOfMonth(year, month) + 6) % 7; // Adjust to start Monday

  const prevMonth = () => setCurrentMonth(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentMonth(new Date(year, month + 1, 1));

  const monthName = currentMonth.toLocaleString('it-IT', { month: 'long', year: 'numeric' });

  const calendarDays = [];
  for (let i = 0; i < firstDay; i++) {
    calendarDays.push(null);
  }
  for (let i = 1; i <= days; i++) {
    calendarDays.push(i);
  }

  const getCountForDay = (day: number) => {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return dailyStats.find(s => s.date === dateStr)?.count || 0;
  };

  return (
    <div className="bg-white dark:bg-[#141414] rounded-3xl p-4 md:p-6 border border-black/5 dark:border-white/5 shadow-sm">
      <div className="flex justify-between items-center mb-4 md:mb-6">
        <h3 className="text-lg md:text-xl font-bold capitalize">{monthName}</h3>
        <div className="flex gap-1 md:gap-2">
          <button onClick={prevMonth} className="p-1.5 md:p-2 hover:bg-gray-100 dark:hover:bg-white/5 rounded-full transition-colors"><ChevronLeft size={18} /></button>
          <button onClick={nextMonth} className="p-1.5 md:p-2 hover:bg-gray-100 dark:hover:bg-white/5 rounded-full transition-colors"><ChevronRight size={18} /></button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 md:gap-2">
        {['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'].map(d => (
          <div key={d} className="text-center text-[9px] md:text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 md:mb-2">{d}</div>
        ))}
        {calendarDays.map((day, idx) => {
          if (day === null) return <div key={`empty-${idx}`} />;
          const count = getCountForDay(day);
          const isToday = day === new Date().getDate() && month === new Date().getMonth() && year === new Date().getFullYear();
          const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          
          return (
            <button 
              key={day} 
              onClick={() => onDayClick(dateStr)}
              className={`
                aspect-square flex flex-col items-center justify-center rounded-xl md:rounded-2xl border transition-all relative
                ${isToday 
                  ? 'border-black dark:border-white bg-black dark:bg-white text-white dark:text-black' 
                  : 'border-transparent bg-gray-50 dark:bg-white/5 hover:bg-gray-100 dark:hover:bg-white/10'}
              `}
            >
              <span className={`text-xs md:text-sm font-medium ${isToday ? 'text-white dark:text-black' : 'text-gray-900 dark:text-gray-100'}`}>{day}</span>
              {count > 0 && (
                <div className={`
                  mt-0.5 md:mt-1 px-1 md:px-1.5 py-0.5 rounded md:rounded-md text-[8px] md:text-[9px] font-bold leading-none
                  ${isToday ? 'bg-white dark:bg-black text-black dark:text-white' : 'bg-emerald-500 text-white'}
                `}>
                  {count}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function NavButton({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button 
      onClick={onClick}
      className={`
        flex flex-col md:flex-row items-center justify-center gap-1 md:gap-3 px-2 md:px-4 py-2 md:py-3 rounded-xl md:rounded-2xl transition-all flex-1 md:flex-none
        ${active 
          ? 'text-black dark:text-white bg-black/5 dark:bg-white/10 md:bg-black md:dark:bg-white md:text-white md:dark:text-black font-bold' 
          : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5'
        }
      `}
    >
      <div className="md:scale-100 scale-90">{icon}</div>
      <span className="text-[9px] md:text-sm uppercase md:capitalize tracking-wider md:tracking-normal font-semibold md:font-medium">{label}</span>
    </button>
  );
}

function StatCard({ label, value, icon }: { label: string, value: number, icon: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-[#141414] p-4 md:p-6 rounded-2xl md:rounded-3xl border border-black/5 dark:border-white/5 shadow-sm flex items-center justify-between">
      <div>
        <p className="text-[10px] md:text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">{label}</p>
        <p className="text-2xl md:text-3xl font-light tracking-tighter">{value}</p>
      </div>
      <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl md:rounded-2xl bg-gray-50 dark:bg-white/5 flex items-center justify-center">
        {icon}
      </div>
    </div>
  );
}
