"""把台新行情欄位整理成網頁用的純資料。不連線、不讀帳號。"""

from __future__ import annotations

from typing import Any


def as_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def as_levels(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, (list, tuple)):
        return [as_text(item) for item in value]
    text = as_text(value)
    if not text:
        return []
    return [part.strip() for part in text.split(",")]


def parse_number(value: Any) -> float | None:
    text = as_text(value).replace(",", "")
    if not text or text in {"-", "--"}:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def format_price(value: Any) -> str:
    number = parse_number(value)
    if number is None:
        return "—"
    text = f"{number:.2f}".rstrip("0").rstrip(".")
    return text or "0"


def format_qty(value: Any) -> str:
    number = parse_number(value)
    if number is None:
        return "—"
    return f"{int(round(number)):,}"


def price_change(match_price: Any, ref_price: Any) -> dict[str, Any]:
    match = parse_number(match_price)
    ref = parse_number(ref_price)
    if match is None or ref is None or ref == 0:
        return {"diff": None, "percent": None, "direction": "flat"}
    diff = match - ref
    if abs(diff) < 1e-9:
        direction = "flat"
    elif diff > 0:
        direction = "up"
    else:
        direction = "down"
    return {
        "diff": diff,
        "percent": diff / ref * 100,
        "direction": direction,
    }


def tick_fields(data: Any, *, book: bool) -> dict[str, Any]:
    symbol = as_text(getattr(data, "Symbol", ""))
    fields: dict[str, Any] = {"symbol": symbol}
    if book:
        fields.update(
            {
                "orderBookTime": as_text(getattr(data, "OrderBookTime", "")),
                "buyPrice": as_levels(getattr(data, "BuyPrice", None)),
                "buyQty": as_levels(getattr(data, "BuyQty", None)),
                "sellPrice": as_levels(getattr(data, "SellPrice", None)),
                "sellQty": as_levels(getattr(data, "SellQty", None)),
            }
        )
        return fields
    fields.update(
        {
            "matchTime": as_text(getattr(data, "MatchTime", "")),
            "matchPrice": as_text(getattr(data, "MatchPrice", "")),
            "matchQty": as_text(getattr(data, "MatchQty", "")),
            "totalMatchQty": as_text(getattr(data, "TotalMatchQty", "")),
            "dayHigh": as_text(getattr(data, "DayHigh", "")),
            "dayLow": as_text(getattr(data, "DayLow", "")),
            "openPrice": as_text(getattr(data, "OpenPrice", "")),
            "refPrice": as_text(getattr(data, "RefPrice", "")),
        }
    )
    return fields


def basic_fields(data: Any) -> dict[str, Any]:
    return {
        "symbol": as_text(getattr(data, "Symbol", "")),
        "name": as_text(getattr(data, "ChineseName", "")),
        "refPrice": as_text(getattr(data, "TodayRefPrice", "")),
        "riseStop": as_text(getattr(data, "RiseStopPrice", "")),
        "fallStop": as_text(getattr(data, "FallStopPrice", "")),
    }
