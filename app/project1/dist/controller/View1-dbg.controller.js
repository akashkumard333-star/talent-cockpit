sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "sap/m/SelectDialog",
  "sap/m/StandardListItem",
  "sap/ui/model/Filter",
  "sap/ui/model/FilterOperator",
  "sap/m/MessageBox"
], function (Controller, JSONModel, MessageBox, SelectDialog, StandardListItem, Filter, FilterOperator) {
  "use strict";

  const SERVICE = "odata/v4/talent";

  return Controller.extend("project1.controller.View1", {

    onInit() {
  this.getView().setModel(new sap.ui.model.json.JSONModel({
    Employees: [],
    hasSelection: false,
    kpi: {
      totalEmployees: 0,
      activeEmployees: 0,
      totalProjects: 0,
      avgUtilization: 0
    }
  }), "ui");

  // IMPORTANT: Call KPI loader
  this._computeKPIs();
}
,
    _openF4Global: async function (opts) {
  const { title, field, inputId } = opts;

  try {
    const res = await fetch(`/odata/v4/talent/Employees?$select=${field}`, {
      headers: { "Accept": "application/json" }
    });
    if (!res.ok) throw new Error(`Value help failed (${res.status})`);

    const data = await res.json();
    const values = [...new Set((data.value || []).map(r => r[field]).filter(Boolean))].sort();

    const oModel = new sap.ui.model.json.JSONModel(values.map(v => ({ value: v })));

    const oDlg = new sap.m.SelectDialog({
      title: title,
      liveChange: function (oEvent) {
        const sValue = oEvent.getParameter("value") || "";
        const aFilters = sValue
          ? [new sap.ui.model.Filter("value", sap.ui.model.FilterOperator.Contains, sValue)]
          : [];
        oEvent.getSource().getBinding("items").filter(aFilters);
      },
      confirm: (oEvent) => {
        const oItem = oEvent.getParameter("selectedItem");
        if (oItem) this.byId(inputId).setValue(oItem.getTitle());
      },
      cancel: function () {}
    });

    oDlg.setModel(oModel);
    oDlg.bindAggregation("items", {
      path: "/",
      template: new sap.m.StandardListItem({ title: "{value}" })
    });

    oDlg.open();
  } catch (e) {
    sap.m.MessageBox.error(e.message || "Value help error");
  }
},
onRoleValueHelp: function () {
  this._openF4Global({
    title: "Select Role",
    field: "role",
    inputId: "fRole"
  });
},
onLocationValueHelp: function () {
  this._openF4Global({
    title: "Select Location",
    field: "location",
    inputId: "fLocation"
  });
},
onNameValueHelp: function () {
  this._openF4Global({
    title: "Select Employee Name",
    field: "name",
    inputId: "fName"
  });
},
onSortName: function () {
  this._sortTable("name");
},

onSortRole: function () {
  this._sortTable("role");
},

onSortLevel: function () {
  this._sortTable("level");
},

onSortLocation: function () {
  this._sortTable("location");
},

_sortTable: function (sField) {
  const oTable = this.byId("tblEmployees");
  const oBinding = oTable.getBinding("items");

  if (!this._sortState) this._sortState = {};

  // toggle ascending/descending
  const bDescending = this._sortState[sField] === true;
  this._sortState[sField] = !bDescending;

  const oSorter = new sap.ui.model.Sorter(sField, !bDescending);
  oBinding.sort(oSorter);
},
// add inside your controller (View1.controller.js)
onExportCSV: function () {
  try {
    const oUI = this.getView().getModel("ui");
    const aRows = oUI.getProperty("/Employees") || [];

    if (!aRows.length) {
      sap.m.MessageToast.show("No rows to export");
      return;
    }

    // columns you want to export and header labels
    const aCols = [
      { key: "name", label: "Name" },
      { key: "role", label: "Role" },
      { key: "level", label: "Level" },
      { key: "location", label: "Location" },
      { key: "isActive", label: "Active" }
    ];

    const csv = this._convertToCSV(aRows, aCols);
    this._downloadFile(csv, `employees_${this._timestamp()}.csv`);
    sap.m.MessageToast.show("CSV export ready");
  } catch (e) {
    sap.m.MessageBox.error(e.message || "Export failed");
  }
},

_convertToCSV: function (rows, cols) {
  // create header
  const header = cols.map(c => this._escapeCsv(c.label)).join(",");
  const lines = [header];

  for (const r of rows) {
    const values = cols.map(c => {
      let v = r[c.key];
      if (v === null || v === undefined) v = "";
      // for booleans convert to Yes/No or true/false depending on preference
      if (typeof v === "boolean") v = v ? "Yes" : "No";
      return this._escapeCsv(String(v));
    });
    lines.push(values.join(","));
  }

  // add BOM so Excel recognizes UTF-8
  return "\uFEFF" + lines.join("\r\n");
},

_escapeCsv: function (value) {
  // Escape double quotes by doubling them, and wrap fields with quotes if they contain commas/newlines/quotes
  if (value == null) return "";
  const needsQuotes = /[",\r\n]/.test(value);
  const escaped = value.replace(/"/g, '""');
  return needsQuotes ? `"${escaped}"` : escaped;
},

_downloadFile: function (content, filename) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  if (window.navigator && window.navigator.msSaveOrOpenBlob) {
    // IE fallback
    window.navigator.msSaveOrOpenBlob(blob, filename);
  } else {
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
},

_timestamp: function () {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
},

// call this once in onInit and at the end of onGo() success
_computeKPIs: async function () {
  const oUI = this.getView().getModel("ui");

  try {
    // Employees
    const eRes = await fetch(`${SERVICE}/Employees?$select=ID,isActive&$top=5000`, {
      headers: { Accept: "application/json" }
    });
    if (!eRes.ok) throw new Error(`Employees KPI failed (${eRes.status})`);
    const eData = await eRes.json();
    const employees = eData.value || [];

    const totalEmployees = employees.length;
    const activeEmployees = employees.filter(e => e.isActive === true).length;

    // Projects
    const pRes = await fetch(`${SERVICE}/Projects?$select=ID&$top=5000`, {
      headers: { Accept: "application/json" }
    });
    if (!pRes.ok) throw new Error(`Projects KPI failed (${pRes.status})`);
    const pData = await pRes.json();
    const totalProjects = (pData.value || []).length;

    // Assignments -> utilization
    const aRes = await fetch(`${SERVICE}/Assignments?$select=employee_ID,allocationPercent&$top=5000`, {
      headers: { Accept: "application/json" }
    });
    if (!aRes.ok) throw new Error(`Assignments KPI failed (${aRes.status})`);
    const aData = await aRes.json();
    const assignments = aData.value || [];

    const byEmp = new Map();
    assignments.forEach(a => {
      if (!a.employee_ID) return;
      const cur = byEmp.get(a.employee_ID) || 0;
      byEmp.set(a.employee_ID, cur + (Number(a.allocationPercent) || 0));
    });

    const empCount = byEmp.size;
    const totalAlloc = Array.from(byEmp.values()).reduce((s, v) => s + v, 0);
    const avgUtilization = empCount ? Math.round((totalAlloc / (empCount * 100)) * 100) : 0;

    // SET KPI values (this is what updates your view)
    oUI.setProperty("/kpi/totalEmployees", totalEmployees);
    oUI.setProperty("/kpi/activeEmployees", activeEmployees);
    oUI.setProperty("/kpi/totalProjects", totalProjects);
    oUI.setProperty("/kpi/avgUtilization", avgUtilization);

  } catch (e) {
    console.error("KPI error:", e);
    // keep zeros if KPI fails
    oUI.setProperty("/kpi/totalEmployees", 0);
    oUI.setProperty("/kpi/activeEmployees", 0);
    oUI.setProperty("/kpi/totalProjects", 0);
    oUI.setProperty("/kpi/avgUtilization", 0);
  }
},





    onGo: async function () {
      try {
        const sName = this.byId("fName").getValue().trim();
        const sRole = this.byId("fRole").getValue().trim();
        const sLoc  = this.byId("fLocation").getValue().trim();
        const sAct  = this.byId("fActive").getSelectedKey();

        const a = [];
        if (sName) a.push("contains(tolower(name),'" + this._esc(sName.toLowerCase()) + "')");
        if (sRole) a.push("contains(tolower(role),'" + this._esc(sRole.toLowerCase()) + "')");
        if (sLoc)  a.push("contains(tolower(location),'" + this._esc(sLoc.toLowerCase()) + "')");
        if (sAct === "true" || sAct === "false") a.push("isActive eq " + sAct);

        const sFilter = a.length ? "$filter=" + a.join(" and ") : "";
        const sUrl = SERVICE + "/Employees?$select=ID,name,role,level,location,isActive" +
          (sFilter ? "&" + sFilter : "");

        const res = await fetch(sUrl, { headers: { "Accept": "application/json" } });
        if (!res.ok) throw new Error("Request failed: " + res.status);

        const data = await res.json();
        this.getView().getModel("ui").setProperty("/Employees", data.value || []);

        // reset selection
        this.getView().getModel("ui").setProperty("/hasSelection", false);
        const oTable = this.byId("tblEmployees");
        if (oTable && oTable.removeSelections) {
          oTable.removeSelections();
        }
        await this._computeKPIs();

      } catch (e) {
        MessageBox.error(e.message || "Failed to load employees");
      }

    },
  


    onClear: function () {
      this.byId("fName").setValue("");
      this.byId("fRole").setValue("");
      this.byId("fLocation").setValue("");
      this.byId("fActive").setSelectedKey("");

      this.getView().getModel("ui").setProperty("/Employees", []);
      this.getView().getModel("ui").setProperty("/hasSelection", false);

      const oTable = this.byId("tblEmployees");
      if (oTable && oTable.removeSelections) {
        oTable.removeSelections();
      }
    },

    onSelectionChange: function () {
      const oTable = this.byId("tblEmployees");
      const bHas = !!oTable.getSelectedItem();
      this.getView().getModel("ui").setProperty("/hasSelection", bHas);
    },

    onItemPress: function (oEvent) {
      const oItem = oEvent.getParameter("listItem");
      const oTable = this.byId("tblEmployees");

      // force selection
      oTable.setSelectedItem(oItem);
      this.getView().getModel("ui").setProperty("/hasSelection", true);

      const sId = oItem.getBindingContext("ui").getProperty("ID");

      this.getOwnerComponent().getRouter().navTo("RouteView2", {
        employeeId: encodeURIComponent(sId)
      });
    },

    onEdit: function () {
      const oTable = this.byId("tblEmployees");
      const oItem = oTable.getSelectedItem();
      if (!oItem) return;

      const sId = oItem.getBindingContext("ui").getProperty("ID");

      this.getOwnerComponent().getRouter().navTo("RouteView3", {
        employeeId: encodeURIComponent(sId)
      });
    },

    _esc: function (s) {
      return s.replace(/'/g, "''");
    }

  });
});
