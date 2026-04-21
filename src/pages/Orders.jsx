import React, { useEffect, useState, useMemo } from "react";
import {
  collection,
  getDocs,
  doc,
  updateDoc,
  deleteDoc,
  addDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../../firebase";
import { onSnapshot } from "firebase/firestore";
import {
  User,
  Edit,
  Trash2,
  Eye,
  RefreshCw,
  Search,
  Filter,
  Calendar,
  DollarSign,
  Package,
  Truck,
  CheckCircle,
  XCircle,
  Clock,
  ChevronRight,
  Download,
  MapPin,
  Phone,
  CreditCard,
  ShoppingBag,
  ExternalLink,
  MoreVertical,
  X,
  ArrowUpRight
} from "lucide-react";

/* ======================================================
   🔥 INLINE ORDER SERVICE
====================================================== */

const orderService = {
  getAll: async () => {
    const usersSnap = await getDocs(collection(db, "users"));
    const orders = [];

    for (const userDoc of usersSnap.docs) {
      const userId = userDoc.id;
      const userData = userDoc.data();

      const ordersSnap = await getDocs(
        collection(db, "users", userId, "orders")
      );

      ordersSnap.forEach((orderDoc) => {
        const orderData = orderDoc.data();
        orders.push({
          id: orderDoc.id,
          orderId: orderData.orderId || `ORD-${orderDoc.id.slice(0, 8).toUpperCase()}`,
          customerId: userId,
          customerName: userData.userName || userData.displayName || "Unknown Customer" ,
          customerEmail: userData.email || "",
          customerPhone: userData.phone || "",
          ...orderData,
        });
      });
    }
    return orders.sort((a, b) => b.createdAt?.seconds - a.createdAt?.seconds);
  },

  updateStatus: async (orderId, status, customerId) => {
    await updateDoc(
      doc(db, "users", customerId, "orders", orderId),
      { orderStatus: status, updatedAt: serverTimestamp() }
    );
  },

  delete: async (orderId, customerId) => {
    await deleteDoc(doc(db, "users", customerId, "orders", orderId));
  },
};

/* ======================================================
   🧩 MAIN COMPONENT
====================================================== */

const Orders = () => {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewOrder, setViewOrder] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("all");


  
  const loadOrders = async () => {
    setLoading(true);
    try {
      const data = await orderService.getAll();
      setOrders(data);
    } catch (error) {
      console.error("Error loading orders:", error);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadOrders();
  }, []);

  const formatDate = (ts) => {
    if (!ts?.seconds) return "N/A";
    const date = new Date(ts.seconds * 1000);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const formatTime = (ts) => {
    if (!ts?.seconds) return "";
    const date = new Date(ts.seconds * 1000);
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit'
    });
  };

const API_URL = window.location.origin;

  const sendOrderEmail = async (data) => {
  try {
    await fetch(`${API_URL}/api/sendEmail`.replace(/([^:]\/)\/+/g, "$1"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });
  } catch (err) {
    console.error("Email failed", err);
  }
};

useEffect(() => {
  const unsubscribeList = new Map(); // Use a map to track listeners by userId

  const setupUserListener = (userId, userData) => {
    if (unsubscribeList.has(userId)) return;

    let isInitialLoad = true;
    const unsubscribe = onSnapshot(
      collection(db, "users", userId, "orders"),
      (snapshot) => {
        if (isInitialLoad) {
          isInitialLoad = false;
          return;
        }

        snapshot.docChanges().forEach(async (change) => {
          const orderData = change.doc.data();
          const customerEmail = userData.email || orderData.customerEmail || "";
          const customerName = userData.userName || userData.displayName || orderData.customerName || "Customer";
          
          if (!customerEmail) return;

          const orderId = orderData.orderId || `ORD-${change.doc.id.slice(0, 8).toUpperCase()}`;

          if (change.type === "added") {
            await sendOrderEmail({
              userEmail: customerEmail,
              userName: customerName,
              orderId: orderId,
              status: "pending", 
              orderItems: orderData.products || [],
            });
          }

          if (change.type === "modified") {
            await sendOrderEmail({
              userEmail: customerEmail,
              userName: customerName,
              orderId: orderId,
              status: orderData.orderStatus || "pending",
              orderItems: orderData.products || [],
            });
          }
        });
      }
    );
    unsubscribeList.set(userId, unsubscribe);
  };

  // 1. Listen for ALL users (including new ones)
  const unsubscribeUsers = onSnapshot(collection(db, "users"), (snapshot) => {
    snapshot.docs.forEach((userDoc) => {
      setupUserListener(userDoc.id, userDoc.data());
    });
  });

  return () => {
    unsubscribeUsers();
    unsubscribeList.forEach((unsub) => unsub());
  };
}, []);
  const getStatusColor = (status) => {
    switch (status?.toLowerCase()) {
      case 'pending': return { bg: 'bg-yellow-100', text: 'text-yellow-800', icon: Clock };
      case 'processing': return { bg: 'bg-blue-100', text: 'text-blue-800', icon: Package };
      case 'shipped': return { bg: 'bg-purple-100', text: 'text-purple-800', icon: Truck };
      case 'delivered': return { bg: 'bg-green-100', text: 'text-green-800', icon: CheckCircle };
      case 'cancelled': return { bg: 'bg-red-100', text: 'text-red-800', icon: XCircle };
      default: return { bg: 'bg-gray-100', text: 'text-gray-800', icon: Clock };
    }
  };

  const getStatusIcon = (status) => {
    const { icon } = getStatusColor(status);
    const IconComponent = icon;
    return <IconComponent className="w-4 h-4" />;
  };

  const filteredOrders = useMemo(() => {
    let filtered = orders;

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(order =>
        order.customerName.toLowerCase().includes(term) ||
        order.orderId?.toLowerCase().includes(term) ||
        order.customerEmail.toLowerCase().includes(term)
      );
    }

    if (statusFilter !== 'all') {
      filtered = filtered.filter(order => order.orderStatus === statusFilter);
    }

    if (dateFilter !== 'all') {
      const now = new Date();
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      filtered = filtered.filter(order => {
        if (!order.createdAt?.seconds) return false;
        const orderDate = new Date(order.createdAt.seconds * 1000);

        switch (dateFilter) {
          case 'today': return orderDate.toDateString() === now.toDateString();
          case 'week': return orderDate >= sevenDaysAgo;
          case 'month': return orderDate >= thirtyDaysAgo;
          default: return true;
        }
      });
    }

    return filtered;
  }, [orders, searchTerm, statusFilter, dateFilter]);

  const stats = useMemo(() => {
    const total = orders.length;
    const revenue = orders.reduce((sum, order) => sum + (order.totalAmount || 0), 0);
    const pending = orders.filter(o => o.orderStatus === 'pending').length;
    const delivered = orders.filter(o => o.orderStatus === 'delivered').length;

    return { total, revenue, pending, delivered };
  }, [orders]);

  if (loading && orders.length === 0) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="flex flex-col items-center gap-4">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-500 border-t-transparent"></div>
          <p className="text-gray-600">Loading orders...</p>
        </div>
      </div>
    );
  }
  const downloadOrdersCSV = () => {
  if (!filteredOrders.length) {
    alert("No orders to export");
    return;
  }

  const headers = [
    "Order ID",
    "Customer Name",
    "Email",
    "Phone",
    "Order Status",
    "Payment Method",
    "Total Amount",
    "Order Date",
    "Address",
    "Products"
  ];

  const rows = filteredOrders.map(order => {
    const products = order.products
      ?.map(p => `${p.name} (x${p.quantity})`)
      .join(" | ") || "";

    const orderDate = order.createdAt?.seconds
      ? new Date(order.createdAt.seconds * 1000).toLocaleString()
      : "";

    return [
      order.orderId,
      order.customerName,
      order.customerEmail,
      order.phoneNumber || "",
      order.orderStatus,
      order.paymentMethod || "",
      order.totalAmount,
      orderDate,
      order.address || "",
      products
    ];
  });

  const csvContent =
    [headers, ...rows]
      .map(row =>
        row
          .map(value => `"${String(value).replace(/"/g, '""')}"`)
          .join(",")
      )
      .join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", `orders_${Date.now()}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};


  return (
    <div className="p-6 bg-white min-h-screen">
      {/* HEADER */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between mb-8 gap-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Order Management</h1>
          <p className="text-gray-600 mt-1">Track and manage all customer orders</p>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 px-4 py-3 rounded-xl border border-blue-100">
            <div className="text-sm text-gray-600">Total Revenue</div>
            <div className="text-2xl font-bold text-gray-900">₹{stats.revenue.toLocaleString()}</div>
          </div>
          
          <button
            onClick={loadOrders}
            className="flex items-center gap-2 px-5 py-3 bg-white border border-gray-300 rounded-xl hover:bg-gray-50 transition-colors shadow-sm"
          >
            <RefreshCw size={18} />
            Refresh
          </button>
        </div>
      </div>

      {/* STATS CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="bg-gradient-to-br from-blue-500 to-blue-600 text-white rounded-2xl p-6 shadow-lg">
          <div className="flex justify-between items-center">
            <div>
              <div className="text-sm text-blue-100">Total Orders</div>
              <div className="text-3xl font-bold mt-2">{stats.total}</div>
            </div>
            <ShoppingBag className="w-12 h-12 text-blue-200 opacity-80" />
          </div>
        </div>

        <div className="bg-gradient-to-br from-emerald-500 to-emerald-600 text-white rounded-2xl p-6 shadow-lg">
          <div className="flex justify-between items-center">
            <div>
              <div className="text-sm text-emerald-100">Delivered</div>
              <div className="text-3xl font-bold mt-2">{stats.delivered}</div>
            </div>
            <CheckCircle className="w-12 h-12 text-emerald-200 opacity-80" />
          </div>
        </div>

        <div className="bg-gradient-to-br from-orange-500 to-orange-600 text-white rounded-2xl p-6 shadow-lg">
          <div className="flex justify-between items-center">
            <div>
              <div className="text-sm text-orange-100">Pending</div>
              <div className="text-3xl font-bold mt-2">{stats.pending}</div>
            </div>
            <Clock className="w-12 h-12 text-orange-200 opacity-80" />
          </div>
        </div>

        <div className="bg-gradient-to-br from-purple-500 to-purple-600 text-white rounded-2xl p-6 shadow-lg">
          <div className="flex justify-between items-center">
            <div>
              <div className="text-sm text-purple-100">Avg. Order</div>
              <div className="text-3xl font-bold mt-2">
                ₹{stats.total > 0 ? Math.round(stats.revenue / stats.total) : 0}
              </div>
            </div>
            <DollarSign className="w-12 h-12 text-purple-200 opacity-80" />
          </div>
        </div>
      </div>

      {/* FILTERS & SEARCH */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-6 mb-8 border border-blue-100">
        <div className="flex flex-col lg:flex-row gap-4">
          {/* SEARCH */}
          <div className="flex-1 relative">
            <Search className="absolute left-4 top-3.5 text-gray-400" size={20} />
            <input
              className="w-full bg-white border border-gray-300 rounded-xl py-3 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent shadow-sm"
              placeholder="Search orders by customer, order ID, or email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm("")}
                className="absolute right-4 top-3.5 text-gray-400 hover:text-gray-600"
              >
                <X size={20} />
              </button>
            )}
          </div>

          {/* FILTERS */}
          <div className="flex gap-3">
            <div className="relative">
              <Filter className="absolute left-3 top-3 text-gray-400" size={18} />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="bg-white border border-gray-300 rounded-xl py-3 pl-10 pr-4 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent appearance-none shadow-sm"
              >
                <option value="all">All Status</option>
                <option value="pending">Pending</option>
                <option value="processing">Processing</option>
                <option value="shipped">Shipped</option>
                <option value="delivered">Delivered</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
            
            <div className="relative">
              <Calendar className="absolute left-3 top-3 text-gray-400" size={18} />
              <select
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                className="bg-white border border-gray-300 rounded-xl py-3 pl-10 pr-4 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent appearance-none shadow-sm"
              >
                <option value="all">All Time</option>
                <option value="today">Today</option>
                <option value="week">Last 7 Days</option>
                <option value="month">Last 30 Days</option>
              </select>
            </div>
          </div>
        </div>
        
        <div className="flex justify-between items-center mt-4">
          <div className="text-sm text-gray-600">
            Showing <span className="font-semibold">{filteredOrders.length}</span> of{" "}
            <span className="font-semibold">{orders.length}</span> orders
          </div>
          
         <button
  onClick={downloadOrdersCSV}
  className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-xl hover:bg-gray-50 transition-colors shadow-sm"
>
  <Download size={18} />
  Export Orders
</button>

        </div>
      </div>

      {/* ORDERS TABLE - DESKTOP */}
      <div className="hidden lg:block bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Order Details</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Customer</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Amount</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Status</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Date</th>
                <th className="px-6 py-4 text-right text-sm font-semibold text-gray-700">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredOrders.length === 0 ? (
                <tr>
                  <td colSpan="6" className="text-center py-12">
                    <div className="flex flex-col items-center gap-3">
                      <Package className="text-gray-300" size={48} />
                      <div className="text-gray-500">No orders found</div>
                      {searchTerm && (
                        <button
                          onClick={() => setSearchTerm("")}
                          className="text-blue-600 hover:text-blue-700 text-sm"
                        >
                          Clear search
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                filteredOrders.map((order) => {
                  const { bg, text } = getStatusColor(order.orderStatus);
                  return (
                    <tr key={order.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4">
                        <div>
                          <div className="font-medium text-gray-900">{order.orderId}</div>
                          <div className="text-sm text-gray-500">
                            {order.products?.length || 0} items
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-500 rounded-lg flex items-center justify-center text-white font-bold">
                            {order.customerName?.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="font-medium text-gray-900">{order.customerName}</div>
                            <div className="text-sm text-gray-500">{order.customerEmail}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-xl font-bold text-gray-900">₹{order.totalAmount}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col gap-2">
                          <span className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium ${bg} ${text}`}>
                            {getStatusIcon(order.orderStatus)}
                            {order.orderStatus}
                          </span>
                          <select
                            value={order.orderStatus}
                            onChange={(e) => {
                              orderService.updateStatus(order.id, e.target.value, order.customerId);
                             
                            }}
                            className="text-sm border border-gray-300 rounded-lg p-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          >
                            <option value="pending">Pending</option>
                            <option value="processing">Processing</option>
                            <option value="shipped">Shipped</option>
                            <option value="delivered">Delivered</option>
                            <option value="cancelled">Cancelled</option>
                          </select>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div>
                          <div className="text-sm font-medium text-gray-900">{formatDate(order.createdAt)}</div>
                          <div className="text-xs text-gray-500">{formatTime(order.createdAt)}</div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => setViewOrder(order)}
                            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 rounded-lg text-sm font-medium transition-colors"
                          >
                            <Eye size={16} />
                            View
                          </button>
                          <button
                            onClick={() => {
                              if (window.confirm("Are you sure you want to delete this order?")) {
                                orderService.delete(order.id, order.customerId);
                                loadOrders();
                              }
                            }}
                            className="inline-flex items-center gap-2 px-4 py-2 bg-red-50 text-red-700 hover:bg-red-100 border border-red-200 rounded-lg text-sm font-medium transition-colors"
                          >
                            <Trash2 size={16} />
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        
        {/* FOOTER */}
        {filteredOrders.length > 0 && (
          <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex justify-between items-center">
            <div className="text-sm text-gray-600">
              Showing <span className="font-semibold">{filteredOrders.length}</span> of{" "}
              <span className="font-semibold">{orders.length}</span> orders
            </div>
            <div className="flex items-center gap-2">
              <button className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm hover:bg-gray-100">
                Previous
              </button>
              <span className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm">1</span>
              <button className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm hover:bg-gray-100">
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* MOBILE CARDS */}
      <div className="lg:hidden space-y-4">
        {filteredOrders.map((order) => {
          const { bg, text } = getStatusColor(order.orderStatus);
          return (
            <div
              key={order.id}
              className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="font-semibold text-gray-900">{order.orderId}</div>
                  <div className="text-sm text-gray-500">{formatDate(order.createdAt)}</div>
                </div>
                <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${bg} ${text}`}>
                  {getStatusIcon(order.orderStatus)}
                  {order.orderStatus}
                </span>
              </div>
              
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-500 rounded-xl flex items-center justify-center text-white font-bold">
                  {order.customerName?.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div className="font-medium text-gray-900">{order.customerName}</div>
                  <div className="text-sm text-gray-500">{order.customerEmail}</div>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <div className="text-sm text-gray-600">Amount</div>
                  <div className="text-xl font-bold text-gray-900">₹{order.totalAmount}</div>
                </div>
                <div>
                  <div className="text-sm text-gray-600">Items</div>
                  <div className="font-medium">{order.products?.length || 0}</div>
                </div>
              </div>
              
              <div className="flex gap-2">
                <button
                  onClick={() => setViewOrder(order)}
                  className="flex-1 inline-flex items-center justify-center gap-2 py-2.5 bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 rounded-lg text-sm font-medium transition-colors"
                >
                  <Eye size={16} />
                  View Details
                </button>
                <button
                  onClick={() => {
                    if (window.confirm("Are you sure you want to delete this order?")) {
                      orderService.delete(order.id, order.customerId);
                      loadOrders();
                    }
                  }}
                  className="flex-1 inline-flex items-center justify-center gap-2 py-2.5 bg-red-50 text-red-700 hover:bg-red-100 border border-red-200 rounded-lg text-sm font-medium transition-colors"
                >
                  <Trash2 size={16} />
                  Delete
                </button>
              </div>
            </div>
          );
        })}
        
        {filteredOrders.length === 0 && (
          <div className="text-center py-12 bg-white border border-gray-200 rounded-xl">
            <Package className="mx-auto text-gray-300 mb-3" size={48} />
            <div className="text-gray-500 mb-2">No orders found</div>
            {searchTerm && (
              <button
                onClick={() => setSearchTerm("")}
                className="text-blue-600 hover:text-blue-700 text-sm"
              >
                Clear search
              </button>
            )}
          </div>
        )}
      </div>

      {/* ORDER DETAILS MODAL */}
      {viewOrder && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="p-6 border-b border-gray-200">
              <div className="flex justify-between items-center">
                <div>
                  <h2 className="text-2xl font-bold text-gray-900">Order Details</h2>
                  <p className="text-gray-600">{viewOrder.orderId}</p>
                </div>
                <button 
                  onClick={() => setViewOrder(null)}
                  className="p-2 hover:bg-gray-100 rounded-xl"
                >
                  <X size={24} />
                </button>
              </div>
            </div>

            <div className="p-6">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
                {/* Customer Info */}
                <div className="bg-gray-50 rounded-xl p-5">
                  <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                    <User size={18} />
                    Customer Information
                  </h3>
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-500 rounded-xl flex items-center justify-center text-white font-bold text-lg">
                        {viewOrder.customerName?.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="font-medium">{viewOrder.customerName}</div>
                        <div className="text-sm text-gray-600">{viewOrder.customerEmail}</div>
                      </div>
                    </div>
                    {viewOrder.phoneNumber && (
                      <div className="flex items-center gap-2 text-gray-700">
                        <Phone size={16} className="text-gray-400" />
                        <span>{viewOrder.phoneNumber}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Order Info */}
                <div className="bg-gray-50 rounded-xl p-5">
                  <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                    <ShoppingBag size={18} />
                    Order Information
                  </h3>
                  <div className="space-y-3">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Status</span>
                      <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(viewOrder.orderStatus).bg} ${getStatusColor(viewOrder.orderStatus).text}`}>
                        {getStatusIcon(viewOrder.orderStatus)}
                        {viewOrder.orderStatus}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Order Date</span>
                      <span className="font-medium">{formatDate(viewOrder.orderDate || viewOrder.createdAt)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Items</span>
                      <span className="font-medium">{viewOrder.products?.length || 0}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Payment</span>
                      <span className="font-medium flex items-center gap-1">
                        <CreditCard size={16} />
                        {viewOrder.paymentMethod || "Not Specified"}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Summary */}
                <div className="bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-xl p-5">
                  <h3 className="font-semibold mb-4">Order Summary</h3>
                  <div className="space-y-3">
                    <div className="flex justify-between">
                      <span>Subtotal</span>
                      <span>₹{viewOrder.totalAmount}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Shipping</span>
                      <span>₹{viewOrder.shipping || 0}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Tax</span>
                      <span>₹{viewOrder.tax || 0}</span>
                    </div>
                    <div className="border-t border-blue-400 pt-3 mt-3">
                      <div className="flex justify-between font-bold text-lg">
                        <span>Total Amount</span>
                        <span>₹{viewOrder.totalAmount + (viewOrder.shipping || 0) + (viewOrder.tax || 0)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Address Section */}
              {viewOrder.address && (
                <div className="bg-gray-50 rounded-xl p-5 mb-6">
                  <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                    <MapPin size={18} />
                    Delivery Address
                  </h3>
                  <p className="text-gray-700">{viewOrder.address}</p>
                </div>
              )}

              {/* Products Section */}
              <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                <div className="p-4 bg-gray-50 border-b border-gray-200">
                  <h3 className="font-semibold text-gray-900">Order Items</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Product</th>
                        <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">SKU</th>
                        <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Price</th>
                        <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Quantity</th>
                        <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {viewOrder.products?.map((item, index) => (
                        <tr key={index} className="hover:bg-gray-50">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              {item.images?.[0] && (
                                <img 
                                  src={item.images[0]} 
                                  alt={item.name} 
                                  className="w-12 h-12 rounded-lg object-cover border border-gray-200"
                                />
                              )}
                              <div>
                                <div className="font-medium">{item.name}</div>
                                {item.variant && (
                                  <div className="text-sm text-gray-600">{item.variant}</div>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <code className="text-sm text-gray-600">{item.sku}</code>
                          </td>
                          <td className="px-4 py-3 font-medium">₹{item.price}</td>
                          <td className="px-4 py-3">{item.quantity}</td>
                          <td className="px-4 py-3 font-bold text-gray-900">₹{item.price * item.quantity}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex justify-end gap-3 mt-8">
                <button
                  onClick={() => setViewOrder(null)}
                  className="px-6 py-3 bg-gray-100 text-gray-700 rounded-xl font-medium hover:bg-gray-200 transition-colors"
                >
                  Close
                </button>
              
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Orders;
