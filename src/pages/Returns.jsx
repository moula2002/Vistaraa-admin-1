import React, { useState, useEffect, useMemo } from 'react';
import { 
  RotateCcw, Search, Filter, Eye, CheckCircle, 
  XCircle, Clock, IndianRupee, Download, RefreshCw,
  Package, User, Calendar, ExternalLink
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  collection, 
  getDocs, 
  doc, 
  updateDoc, 
  query, 
  orderBy, 
  serverTimestamp,
  collectionGroup,
  getDoc,
  limit
} from 'firebase/firestore';
import { db } from '../../firebase';

const API_BASE_URL = "https://vistaraa-server.vercel.app/api";
const AUTH_TOKEN = "006eb537ffea3dafe0e3a16233c449a1e20510e8f3404b1a456f53cf6ca7f371";

/* ======================================================
   🔥 RETURN SERVICE
====================================================== */

const returnService = {
  enrichReturnsWithUserProfiles: async (docs) => {
    // 1. Robust ID Extraction
    const customerIds = [...new Set(docs
      .map(doc => {
        const data = doc.data();
        if (doc.ref.path.startsWith("users/")) return doc.ref.parent.parent?.id;
        return data.userId || data.customerId || data.uid;
      })
      .filter(id => !!id)
    )];

    // 2. Parallel Profile Fetching
    const userMap = new Map();
    await Promise.all(customerIds.map(async (id) => {
      try {
        const uSnap = await getDoc(doc(db, "users", id));
        if (uSnap.exists()) {
          const uData = uSnap.data();
          userMap.set(id, {
            name: uData.name || uData.userName || uData.displayName,
            email: uData.email,
            pincode: uData.pincode || uData.postalCode || uData.postal_code || uData.zipCode || uData.zip || ""
          });
        }
      } catch (e) {
        console.error(`Error fetching user ${id}:`, e);
      }
    }));

    // 3. Mapping and Enrichment
    return docs.map(doc => {
      const data = doc.data();
      const cid = doc.ref.path.startsWith("users/") 
        ? (doc.ref.parent.parent?.id || "Unknown")
        : (data.userId || data.customerId || "Unknown");
      
      const uProfile = userMap.get(cid) || {};
      const email = data.email || uProfile.email || "";
      const name = data.name || uProfile.name || (email && email.split('@')[0]) || "Customer";
      const pincode = data.pickup_pincode || data.billing_pincode || data.pincode || data.postal_code || data.zipCode || uProfile.pincode || "";

      return {
        id: doc.id,
        customerId: cid,
        customerName: name,
        customerEmail: email,
        pincode: pincode,
        ...data
      };
    });
  },

  extractPincode: (text) => {
    if (!text || typeof text !== 'string') return null;
    // Match 6-digit Indian Pincode
    const match = text.match(/\b\d{6}\b/);
    return match ? match[0] : null;
  },

  getAll: async () => {
    const q = query(
      collectionGroup(db, "return_requests"),
      orderBy("createdAt", "desc"),
      limit(500)
    );
    const snap = await getDocs(q);
    return await returnService.enrichReturnsWithUserProfiles(snap.docs);
  },

  updateStatus: async (requestId, customerId, newStatus) => {
    const ref = doc(db, "users", customerId, "return_requests", requestId);
    await updateDoc(ref, {
      status: newStatus,
      updatedAt: serverTimestamp()
    });
  }
};

const Returns = () => {
  const [returns, setReturns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [error, setError] = useState(null);
  const [approvingId, setApprovingId] = useState(null);

  useEffect(() => {
    fetchReturns();
  }, []);

  const fetchReturns = async () => {
    setLoading(true);
    try {
      setError(null);
      const data = await returnService.getAll();
      setReturns(data);
    } catch (error) {
      console.error("Error fetching returns:", error);
      setError(error.message || String(error));
      
      // Fallback for missing index
      if (error.message.includes("index") || error.code === "failed-precondition") {
        try {
          const fallbackSnap = await getDocs(query(collectionGroup(db, "return_requests"), limit(100)));
          const enriched = await returnService.enrichReturnsWithUserProfiles(fallbackSnap.docs);
          setReturns(enriched);
        } catch (fError) {
          console.error("Fallback failed:", fError);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateStatus = async (ret, newStatus) => {
    try {
      if (newStatus === 'RETURN_APPROVED') {
        if (!ret.customerId) throw new Error("Customer ID missing. Cannot process approval.");
        
        setApprovingId(ret.id);
        
        // 1. Fetch the actual order to get address/pincode (as requested by user)
        const orderSnap = await getDoc(doc(db, "users", ret.customerId, "orders", ret.orderId || ret.id));
        const orderData = orderSnap.exists() ? orderSnap.data() : {};
        
        // 2. Extract pickup details (Aggressive search)
        let pickupPincode = (
          orderData.billing_pincode || 
          orderData.pincode || 
          orderData.shipping_pincode || 
          orderData.postal_code ||
          ret.pincode ||
          returnService.extractPincode(orderData.address) ||
          returnService.extractPincode(orderData.billing_address) ||
          ""
        ).toString().trim();

        if (!pickupPincode || pickupPincode.length < 6) {
          throw new Error(`Invalid Pincode (${pickupPincode || 'Empty'}). Please ensure the user has a valid 6-digit postal code in their profile or address.`);
        }

        const pickupAddress = orderData.billing_address || orderData.address || orderData.shipping_address || "";
        const pickupCity = orderData.billing_city || orderData.city || orderData.shipping_city || "";
        const pickupState = orderData.billing_state || orderData.state || orderData.shipping_state || "";

        // 3. AUTO-FIX: Update the order document if pincode is missing (Self-healing)
        // This ensures the server finds the data when it fetches the order ref.
        const needsFix = !orderData.billing_pincode && !orderData.pincode && pickupPincode;
        if (needsFix) {
          console.log(`Self-healing: Updating order ${ret.orderId || ret.id} with pincode ${pickupPincode}`);
          const orderRef = doc(db, "users", ret.customerId, "orders", ret.orderId || ret.id);
          await updateDoc(orderRef, {
            pincode: pickupPincode,
            billing_pincode: pickupPincode,
            address: pickupAddress // Ensure address is also correctly set if found
          });
        }

        // 4. Call server
        const response = await fetch(`${API_BASE_URL}/approve-return`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${AUTH_TOKEN}`
          },
          body: JSON.stringify({
            userId: ret.customerId,
            orderId: ret.orderId || ret.id
          })
        });

        const result = await response.json();
        
        if (!response.ok) {
          // Robust Error Handling for [object Object] issue
          let errMsg = "Failed to approve return on server";
          if (result.error) {
            if (typeof result.error === 'string') errMsg = result.error;
            else if (result.error.message) errMsg = result.error.message;
            else if (result.error.errors) {
              // Extract first error detail if available (common in Shiprocket)
              const firstErr = Object.values(result.error.errors)[0];
              errMsg = Array.isArray(firstErr) ? firstErr[0] : String(firstErr);
            }
          }
          throw new Error(errMsg);
        }
        
        alert(`Return approved! Shiprocket Pickup Created: ${result.data?.shiprocketShipmentId || "Success"}`);
      } else {
        // Handle other statuses (e.g., REFUNDED)
        await returnService.updateStatus(ret.id, ret.customerId, newStatus);
        alert(`Return status updated to ${newStatus}`);
      }
      
      fetchReturns();
    } catch (error) {
      console.error("Update failed:", error.message || error);
      alert(error.message || "An unexpected error occurred");
    } finally {
      setApprovingId(null);
    }
  };

  const stats = useMemo(() => {
    return {
      total: returns.length,
      pending: returns.filter(r => r.status === 'RETURN_REQUESTED').length,
      approved: returns.filter(r => r.status === 'RETURN_APPROVED').length,
      refunded: returns.filter(r => r.status === 'REFUNDED').length,
    };
  }, [returns]);

  const filteredReturns = useMemo(() => {
    return returns.filter(r => {
      const matchesSearch = 
        r.orderId?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        r.customerName?.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesStatus = statusFilter === 'all' || r.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [returns, searchTerm, statusFilter]);

  return (
    <div className="p-6 bg-[#fcfdff] min-h-screen pb-20">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-10">
        <div>
          <h1 className="text-3xl font-black text-gray-900 tracking-tight flex items-center gap-3">
            <RotateCcw className="text-indigo-600" size={32} />
            Returns & Refunds
          </h1>
          <p className="text-gray-500 font-medium mt-1">Manage product returns and processed refunds.</p>
        </div>
        <button 
          onClick={fetchReturns}
          className="flex items-center gap-2 px-6 py-3 bg-white border border-gray-200 rounded-2xl font-bold shadow-sm hover:bg-gray-50 transition-all active:scale-95"
        >
          <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          Sync Data
        </button>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
        {[
          { label: 'Total Requests', value: stats.total, icon: RotateCcw, color: 'indigo' },
          { label: 'Pending Reviews', value: stats.pending, icon: Clock, color: 'amber' },
          { label: 'Approved Returns', value: stats.approved, icon: CheckCircle, color: 'blue' },
          { label: 'Refunded', value: stats.refunded, icon: IndianRupee, color: 'emerald' },
        ].map((stat, i) => (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            key={stat.label}
            className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm flex items-center gap-5"
          >
            <div className={`w-14 h-14 rounded-2xl bg-${stat.color}-50 flex items-center justify-center text-${stat.color}-600`}>
              <stat.icon size={28} />
            </div>
            <div>
              <div className="text-gray-500 text-sm font-bold uppercase tracking-wider">{stat.label}</div>
              <div className="text-2xl font-black text-gray-900">{stat.value}</div>
            </div>
          </motion.div>
        ))}
      </div>

      <div className="flex flex-col lg:flex-row gap-4 mb-8">
        <div className="flex-1 relative group">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-indigo-500 transition-colors" size={20} />
          <input
            type="text"
            placeholder="Search by Order ID or Customer Name..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-12 pr-4 py-3.5 bg-white border border-gray-100 rounded-2xl shadow-sm focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 outline-none transition-all"
          />
        </div>
        <div className="flex items-center gap-3">
          <select 
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-6 py-3.5 bg-white border border-gray-100 rounded-2xl shadow-sm focus:ring-4 focus:ring-indigo-500/10 outline-none font-bold text-gray-600"
          >
            <option value="all">All Statuses</option>
            <option value="RETURN_REQUESTED">Return Requested</option>
            <option value="RETURN_APPROVED">Approved</option>
            <option value="REFUNDED">Refunded</option>
            <option value="RETURN_REJECTED">Rejected</option>
          </select>
        </div>
      </div>

      {/* Table Section */}
      <div className="bg-white rounded-[2rem] border border-gray-100 shadow-xl overflow-hidden">
        {loading ? (
          <div className="py-20 flex flex-col items-center gap-4">
            <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
            <p className="text-gray-500 font-bold">Fetching return records...</p>
          </div>
        ) : filteredReturns.length === 0 ? (
          <div className="py-20 flex flex-col items-center text-center opacity-60">
            <RotateCcw size={64} className="mb-4 text-gray-300" />
            <h3 className="text-xl font-black text-gray-900">No Return Requests Found</h3>
            <p className="text-gray-500 font-medium max-w-xs mx-auto">Either there are no returns in the system, or your filters don't match any data.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-gray-50/50 border-b border-gray-100">
                  <th className="px-8 py-5 text-left text-[11px] font-black text-gray-400 uppercase tracking-widest">Order Details</th>
                  <th className="px-8 py-5 text-left text-[11px] font-black text-gray-400 uppercase tracking-widest">Customer</th>
                  <th className="px-8 py-5 text-left text-[11px] font-black text-gray-400 uppercase tracking-widest">Amount</th>
                  <th className="px-8 py-5 text-left text-[11px] font-black text-gray-400 uppercase tracking-widest">Status</th>
                  <th className="px-8 py-5 text-right text-[11px] font-black text-gray-400 uppercase tracking-widest">Management</th>
                  <th className="px-8 py-5 text-right text-[11px] font-black text-gray-400 uppercase tracking-widest">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredReturns.map((ret) => (
                  <tr key={ret.id} className="group hover:bg-gray-50/50 transition-colors">
                    <td className="px-8 py-6">
                      <div className="font-black text-gray-900 mb-0.5">#{ret.orderId || ret.id.slice(0, 8)}</div>
                      <div className="text-[10px] font-bold text-gray-400 uppercase">{new Date(ret.createdAt?.seconds * 1000).toLocaleDateString()}</div>
                    </td>
                    <td className="px-8 py-6">
                      <div className="font-bold text-gray-900">{ret.customerName}</div>
                      <div className="text-xs text-gray-500">{ret.customerEmail}</div>
                    </td>
                    <td className="px-8 py-6 text-indigo-600 font-black">
                      ₹{ret.totalAmount}
                    </td>
                    <td className="px-8 py-6">
                      <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${
                        ret.status === 'REFUNDED' ? 'bg-emerald-50 text-emerald-600' :
                        ret.status === 'RETURN_APPROVED' ? 'bg-blue-50 text-blue-600' :
                        ret.status === 'RETURN_REJECTED' ? 'bg-rose-50 text-rose-600' :
                        'bg-amber-50 text-amber-600'
                      }`}>
                        {ret.status?.replace('_', ' ') || 'Pending Review'}
                      </span>
                    </td>
                    <td className="px-8 py-6 text-right">
                      <div className="flex items-center justify-end gap-2 text-[10px] font-black">
                        <button 
                          onClick={() => handleUpdateStatus(ret, 'REFUNDED')}
                          disabled={ret.status === 'REFUNDED' || approvingId === ret.id}
                          className="px-6 py-2.5 bg-emerald-50 text-emerald-600 rounded-xl hover:bg-emerald-600 hover:text-white transition-all disabled:opacity-30 flex items-center gap-2"
                        >
                          <CheckCircle size={14} />
                          {approvingId === ret.id ? 'Processing...' : 'Refund Completed'}
                        </button>
                      </div>
                    </td>
                    <td className="px-8 py-6 text-right">
                      <button 
                        onClick={() => setSelectedRequest(ret)}
                        className="p-2 bg-gray-50 text-gray-400 hover:bg-indigo-50 hover:text-indigo-600 rounded-xl transition-all"
                      >
                        <Eye size={18} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* DETAIL MODAL */}
      <AnimatePresence>
        {selectedRequest && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-8">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedRequest(null)}
              className="absolute inset-0 bg-gray-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-4xl bg-white rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col max-h-full"
            >
              {/* Modal Header */}
              <div className="p-8 border-b border-gray-50 flex justify-between items-center bg-gray-50/30">
                <div>
                  <h2 className="text-2xl font-black text-gray-900 leading-tight">Return Request Details</h2>
                  <p className="text-gray-500 font-bold text-sm tracking-wide mt-1 uppercase">Order #{selectedRequest.orderId || selectedRequest.id.slice(0, 8)}</p>
                </div>
                <button 
                  onClick={() => setSelectedRequest(null)}
                  className="p-3 bg-white border border-gray-100 rounded-2xl text-gray-400 hover:text-red-500 hover:shadow-lg transition-all"
                >
                  <XCircle size={24} />
                </button>
              </div>

              {/* Modal Content */}
              <div className="p-8 overflow-y-auto custom-scrollbar">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
                  
                  {/* Info Column */}
                  <div className="space-y-8">
                    {/* Customer & Reason */}
                      <div className="bg-gray-50/50 p-6 rounded-[2rem] border border-gray-50">
                        <div className="flex items-center gap-4 mb-6">
                          <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center text-white">
                            <User size={24} />
                          </div>
                          <div>
                            <p className="text-xs font-black text-gray-400 uppercase tracking-widest">Customer</p>
                            <p className="text-lg font-black text-gray-900">{selectedRequest.customerName}</p>
                            <p className="text-[10px] text-indigo-500 font-bold uppercase tracking-widest bg-indigo-50 px-2 py-0.5 rounded-md inline-block mt-1">
                              Zip: {selectedRequest.pincode || "Missing"}
                            </p>
                          </div>
                        </div>
                        
                        <div className="space-y-4">
                        <div>
                          <p className="text-[10px] font-black text-indigo-500 uppercase tracking-[0.2em] mb-1">Return Reason</p>
                          <p className="text-gray-900 font-bold text-lg leading-snug">{selectedRequest.reason || "No reason specified"}</p>
                        </div>
                        {selectedRequest.manualReason && (
                          <div className="p-4 bg-white border border-gray-100 rounded-2xl">
                            <p className="text-[10px] font-black text-gray-400 uppercase mb-2">Additional Comments</p>
                            <p className="text-gray-600 text-sm font-medium italic">"{selectedRequest.manualReason}"</p>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Bank Details */}
                    {selectedRequest.bankDetails && (
                      <div className="bg-emerald-50/30 p-8 rounded-[2rem] border border-emerald-100/50">
                        <div className="flex items-center gap-3 mb-6 font-black text-emerald-600 uppercase tracking-tighter text-sm">
                          <IndianRupee size={20} />
                          Refund Bank Details
                        </div>
                        <div className="grid grid-cols-2 gap-6">
                          <div>
                            <p className="text-[10px] font-bold text-emerald-600/60 uppercase">Beneficiary Name</p>
                            <p className="font-black text-gray-900">{selectedRequest.bankDetails.name || "—"}</p>
                          </div>
                          <div>
                            <p className="text-[10px] font-bold text-emerald-600/60 uppercase">Account Number</p>
                            <p className="font-black text-gray-900">{selectedRequest.bankDetails.accNo || "—"}</p>
                          </div>
                          <div>
                            <p className="text-[10px] font-bold text-emerald-600/60 uppercase">Bank Name</p>
                            <p className="font-black text-gray-900">{selectedRequest.bankDetails.bankName || "—"}</p>
                          </div>
                          <div>
                            <p className="text-[10px] font-bold text-emerald-600/60 uppercase">IFSC Code</p>
                            <p className="font-black text-gray-900">{selectedRequest.bankDetails.ifsc || "—"}</p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Images Column */}
                  <div className="space-y-6">
                    <div className="flex items-center justify-between font-black text-[11px] uppercase tracking-widest text-gray-400 px-2">
                      <span>Evidence Photos</span>
                      <span className="bg-gray-100 px-2 py-0.5 rounded-md">{selectedRequest.images?.length || 0} Images</span>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4">
                      {selectedRequest.images && selectedRequest.images.length > 0 ? (
                        selectedRequest.images.map((img, idx) => (
                          <a 
                            key={idx} 
                            href={img} 
                            target="_blank" 
                            rel="noreferrer"
                            className="aspect-square bg-gray-100 rounded-3xl overflow-hidden border border-gray-100 shadow-sm hover:shadow-xl transition-all group relative"
                          >
                            <img src={img} alt={`Proof ${idx}`} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />
                            <div className="absolute inset-0 bg-indigo-600/0 group-hover:bg-indigo-600/20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all">
                              <ExternalLink className="text-white" size={24} />
                            </div>
                          </a>
                        ))
                      ) : (
                        <div className="col-span-2 py-12 flex flex-col items-center justify-center bg-gray-50 rounded-[2rem] border border-dashed border-gray-200">
                          <Package className="text-gray-300 mb-3" size={32} />
                          <p className="text-gray-400 font-bold text-sm">No photos provided</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="p-8 border-t border-gray-50 flex gap-4">
                <button 
                  onClick={() => {
                    handleUpdateStatus(selectedRequest, 'REFUNDED');
                    setSelectedRequest(null);
                  }}
                  className="flex-1 py-4 bg-emerald-600 text-white rounded-2xl font-black text-sm uppercase tracking-widest shadow-xl shadow-emerald-200 hover:shadow-emerald-300 hover:-translate-y-1 transition-all active:translate-y-0 flex items-center justify-center gap-3"
                >
                  <CheckCircle size={20} />
                  Refund Completed
                </button>
                <button 
                  onClick={() => setSelectedRequest(null)}
                  className="px-10 py-4 bg-gray-50 text-gray-500 rounded-2xl font-black text-sm uppercase tracking-widest hover:bg-gray-100 transition-all"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Returns;
