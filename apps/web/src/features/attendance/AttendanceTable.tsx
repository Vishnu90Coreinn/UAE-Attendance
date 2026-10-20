import type { AttendanceRow } from "../../api/attendance";
import { dailyPay } from "../../utils/dailyPay";
import { changed, validateHours, type AttendanceForm } from "./attendanceForm";

const inputClass =
  "min-h-11 w-28 rounded-lg border border-gray-300 bg-white px-3 text-base text-gray-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:bg-gray-100 disabled:text-gray-600";
export function AttendanceTable({
  rows,
  forms,
  editable,
  pending,
  maximum,
  companyRate,
  onChange,
}: {
  rows: AttendanceRow[];
  forms: AttendanceForm[];
  editable: boolean;
  pending: boolean;
  maximum: number;
  companyRate: number;
  onChange: (id: number, patch: Partial<AttendanceForm>) => void;
}) {
  return (
    <div className="relative min-w-0 overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Daily attendance and pay in AED</caption>
        <thead className="border-b border-gray-200 bg-gray-50 text-gray-700">
          <tr>
            {[
              "Worker",
              "Status",
              "Basic Hours",
              "Overtime Hours",
              "Total Pay (AED)",
            ].map((label) => (
              <th
                key={label}
                scope="col"
                className="whitespace-nowrap px-4 py-3 font-semibold"
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {rows.map((row, index) => {
            const form = forms[index];
            const invalid = validateHours(form, maximum);
            const pay = changed(form, row)
              ? invalid
                ? null
                : dailyPay(
                    form.status,
                    Number(form.basicHours),
                    Number(form.overtimeHours),
                    row.worker.hourlyRate,
                    companyRate,
                    row.worker.overtimeRate,
                  ).totalPay
              : row.dailyPay.totalPay;
            return (
              <tr key={row.worker.id}>
                <th
                  scope="row"
                  className="min-w-48 px-4 py-3 font-medium text-gray-800"
                >
                  {row.worker.fullName}
                  <span className="block text-xs font-normal text-gray-600">
                    {row.worker.workerCode} · {row.worker.designation}
                    {!row.worker.isActive && " · Inactive"}
                  </span>
                </th>
                <td className="px-4 py-3">
                  {editable ? (
                    <>
                      <label
                        className="sr-only"
                        htmlFor={`status-${form.workerId}`}
                      >
                        Status for {row.worker.fullName}
                      </label>
                      <select
                        id={`status-${form.workerId}`}
                        className={`${inputClass} w-40`}
                        value={form.status ?? ""}
                        disabled={pending}
                        onChange={(e) =>
                          onChange(form.workerId, {
                            status: (e.target.value ||
                              null) as AttendanceForm["status"],
                            basicHours: "0",
                            overtimeHours: "0",
                          })
                        }
                      >
                        <option value="">Not recorded</option>
                        <option>Present</option>
                        <option>Absent</option>
                      </select>
                    </>
                  ) : (
                    <span className="whitespace-nowrap rounded-full bg-gray-100 px-3 py-1 text-gray-800">
                      {form.status ?? "Not recorded"}
                    </span>
                  )}
                </td>
                {(["basicHours", "overtimeHours"] as const).map((field) => (
                  <td key={field} className="px-4 py-3">
                    {editable ? (
                      <>
                        <label
                          className="sr-only"
                          htmlFor={`${field}-${form.workerId}`}
                        >
                          {field === "basicHours"
                            ? "Basic hours"
                            : "Overtime hours"}{" "}
                          for {row.worker.fullName}
                        </label>
                        <input
                          id={`${field}-${form.workerId}`}
                          type="number"
                          inputMode="decimal"
                          min="0"
                          max={field === "basicHours" ? maximum : 24}
                          step="0.01"
                          className={inputClass}
                          value={form[field]}
                          disabled={pending || form.status !== "Present"}
                          onChange={(e) =>
                            onChange(form.workerId, { [field]: e.target.value })
                          }
                        />
                      </>
                    ) : (
                      Number(form[field]).toFixed(2)
                    )}
                  </td>
                ))}
                <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-gray-800">
                  {pay === null ? "—" : pay.toFixed(2)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
