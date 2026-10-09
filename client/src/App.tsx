import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { homeFor, useAuth } from './lib/auth';
import { menuOfPath, menuOn } from './lib/menus';
import Layout from './components/Layout';
import Login from './pages/Login';
import ChangePassword from './pages/ChangePassword';
import SuperAdmin from './pages/SuperAdmin';
import SchoolDetail from './pages/SchoolDetail';
import Analytics from './pages/Analytics';
import Backup from './pages/Backup';
import Dashboard from './pages/Dashboard';
import Students from './pages/Students';
import Attendance from './pages/Attendance';
import Fees from './pages/Fees';
import FeeStructure from './pages/FeeStructure';
import FeeCollectors from './pages/FeeCollectors';
import FeeHeads from './pages/FeeHeads';
import Discounts from './pages/Discounts';
import DiscountReport from './pages/DiscountReport';
import FeeRecords from './pages/FeeRecords';
import FeeReports from './pages/FeeReports';
import CustomFees from './pages/CustomFees';
import FeeMonths from './pages/FeeMonths';
import LateFee from './pages/LateFee';

/** Sign-in + role check + "menu switched off by the super admin" check (the page is only hidden, nothing else changes). */
function Guard({ roles }: { roles?: string[] }) {
  const { user } = useAuth();
  const { pathname } = useLocation();
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to={homeFor(user.role, user.disabled_menus)} replace />;
  const key = user.role === 'SUPER_ADMIN' ? null : menuOfPath(pathname);
  if (key && !menuOn(user.disabled_menus, key)) {
    const home = homeFor(user.role, user.disabled_menus);
    if (home !== pathname) return <Navigate to={home} replace />;
    return <p className="rounded-md bg-late/10 p-4 text-sm text-late">Your school's menus are switched off. Contact support.</p>;
  }
  return <Outlet />;
}

export default function App() {
  const { user } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<Guard />}>
        <Route element={<Layout />}>
          <Route path="/change-password" element={<ChangePassword />} />
          <Route element={<Guard roles={['SUPER_ADMIN']} />}>
            <Route path="/superadmin" element={<SuperAdmin />} />
            <Route path="/superadmin/schools/:id" element={<SchoolDetail />} />
            <Route path="/superadmin/analytics" element={<Analytics />} />
            <Route path="/superadmin/backup" element={<Backup />} />
          </Route>
          <Route element={<Guard roles={['SCHOOL_ADMIN', 'TEACHER']} />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/students" element={<Students />} />
            <Route path="/attendance" element={<Attendance />} />
          </Route>
          <Route element={<Guard roles={['SCHOOL_ADMIN', 'FEES_COLLECTOR']} />}>
            <Route path="/fees" element={<Navigate to="/fees/collect" replace />} />
            <Route path="/fees/collect" element={<Fees />} />
            <Route path="/fees/records" element={<FeeRecords />} />
            <Route path="/fees/reports" element={<FeeReports />} />
            <Route path="/fees/structure" element={<FeeStructure />} />
          </Route>
          <Route element={<Guard roles={['SCHOOL_ADMIN']} />}>
            <Route path="/fees/heads" element={<FeeHeads />} />
            <Route path="/fees/months" element={<FeeMonths />} />
            <Route path="/fees/late" element={<LateFee />} />
            <Route path="/fees/custom" element={<CustomFees />} />
            <Route path="/fees/discounts" element={<Discounts />} />
            <Route path="/fees/discount-report" element={<DiscountReport />} />
            <Route path="/fees/collectors" element={<FeeCollectors />} />
            <Route path="/backup" element={<Backup />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to={user ? homeFor(user.role, user.disabled_menus) : '/login'} replace />} />
    </Routes>
  );
}
