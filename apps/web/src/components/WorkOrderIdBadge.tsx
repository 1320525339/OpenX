import { formatWorkOrderId } from "@openx/shared";

type Props = {
  orderNo?: number | null;
  className?: string;
  title?: string;
};

/** 全局任务单序号展示：WO-000042 */
export function WorkOrderIdBadge({
  orderNo,
  className = "",
  title = "任务单号",
}: Props) {
  if (!orderNo || orderNo <= 0) return null;
  return (
    <span
      className={`work-order-id-badge${className ? ` ${className}` : ""}`}
      title={title}
    >
      {formatWorkOrderId(orderNo)}
    </span>
  );
}
