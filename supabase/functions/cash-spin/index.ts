
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);
const headers = {
  "content-type":"application/json; charset=utf-8",
  "access-control-allow-origin":"*",
  "access-control-allow-headers":"content-type,x-admin-pin"
};
const out=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
const SPECIAL_LABEL="원하는 컨텐츠 룰렛 하나 킵";

async function requireAdmin(req:Request){
  const pin=req.headers.get("x-admin-pin")||"";
  const check=await fetch(
    Deno.env.get("SUPABASE_URL")!+"/functions/v1/cash-board",
    {
      method:"POST",
      headers:{"content-type":"application/json","x-admin-pin":pin},
      body:JSON.stringify({action:"bootstrap"})
    }
  );
  if(check.status===401) throw new Error("unauthorized");
}

async function getUserByNick(nickname:string){
  const {data,error}=await db.from("cash_users").select("*").eq("nickname",nickname).maybeSingle();
  if(error) throw error;
  return data as any;
}

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers});
  try{
    await requireAdmin(req);
    const body=await req.json();
    const user=await getUserByNick(String(body.nickname||"").trim());
    if(!user) return out({error:"사용자를 찾을 수 없어."},404);

    const requestedCount=Math.max(1,Math.round(Number(body.count||1)));
    const rouletteId=Number(body.roulette_id||0);
    const [
      {data:roulette,error:rouletteError},
      {data:global,error:globalError},
      {data:items,error:itemsError}
    ]=await Promise.all([
      db.from("cash_roulettes").select("*").eq("id",rouletteId).eq("active",true).maybeSingle(),
      db.from("cash_global_state").select("discount_percent,golden_ticket_percent").eq("id",1).single(),
      db.from("cash_roulette_items").select("*").eq("roulette_id",rouletteId).order("sort_order").order("id")
    ]);
    if(rouletteError) throw rouletteError;
    if(globalError) throw globalError;
    if(itemsError) throw itemsError;
    if(!roulette) return out({error:"사용할 수 없는 룰렛이야."},400);
    if(String(roulette.name)==="경마 게임") return out({error:"경마 게임은 전용 화면에서 진행해줘."},400);
    const count=Math.max(1,Math.min(String(roulette.name)==="100캐시 룰렛"?50:5,requestedCount));
    if(!items?.length) return out({error:"룰렛 항목이 비어 있어."},400);

    const discountValue=Number(global?.discount_percent||0);
    const goldenTicketPercent=Math.max(0,Math.min(100,Number(global?.golden_ticket_percent??5)));
    const effectiveCost=Math.max(0,Math.round(Number(roulette.cost||0)*(100-discountValue)/100));
    const totalCost=effectiveCost*count;
    const startingBalance=Number(user.cash_balance||0);

    if(startingBalance<totalCost){
      return out({error:"캐시가 부족해.",required:totalCost,balance:startingBalance},400);
    }

    const totalWeight=(items||[]).reduce(
      (sum:number,item:any)=>sum+Math.max(0,Number(item.weight||0)),0
    );
    if(totalWeight<=0) return out({error:"룰렛 항목이 비어 있어."},400);

    let balance=startingBalance-totalCost;
    let spentTotal=totalCost;
    const results:any[]=[];

    const goldenTicketEligible=String(roulette.name)!=="100캐시 룰렛";

    for(let idx=1;idx<=count;idx+=1){
      const goldenHit=
        goldenTicketEligible &&
        (Math.random()*100)<goldenTicketPercent;

      let roll=Math.random()*totalWeight;
      let cursor=0;
      let hit:any=(items||[])[(items||[]).length-1];

      for(const item of items||[]){
        cursor+=Math.max(0,Number(item.weight||0));
        if(roll<=cursor){
          hit=item;
          break;
        }
      }

      const note=JSON.stringify({
        result:hit.label,
        result_type:hit.result_type,
        result_item_id:hit.id,
        time_limit_minutes:Number(hit.time_limit_minutes||0),
        resolved:hit.result_type!=="keep",
        batch_index:idx,
        batch_count:count,
        discount_percent:discountValue,
        effective_cost:effectiveCost,
        golden_ticket_percent:goldenTicketPercent
      });

      const {data:spinTx,error:spinTxError}=await db
        .from("cash_transactions")
        .insert({
          user_id:user.id,
          type:"roulette_spend",
          amount:-effectiveCost,
          item_name:roulette.name,
          note
        })
        .select("id")
        .single();
      if(spinTxError) throw spinTxError;

      let appliedDelta=0;

      if(hit.result_type==="cash"&&Number(hit.cash_amount||0)>0){
        appliedDelta=Number(hit.cash_amount||0);
        balance+=appliedDelta;

        const {error:rewardError}=await db.from("cash_transactions").insert({
          user_id:user.id,
          type:"roulette_reward",
          amount:appliedDelta,
          item_name:roulette.name,
          note:hit.label
        });
        if(rewardError) throw rewardError;
      }else if(hit.result_type==="cash_loss"&&Number(hit.cash_amount||0)>0){
        const lossValue=Math.min(Number(hit.cash_amount||0),Math.max(0,balance));
        appliedDelta=-lossValue;
        balance=Math.max(0,balance-lossValue);
        spentTotal+=lossValue;

        const {error:penaltyError}=await db.from("cash_transactions").insert({
          user_id:user.id,
          type:"roulette_penalty",
          amount:-lossValue,
          item_name:roulette.name,
          note:JSON.stringify({
            label:hit.label,
            requested:Number(hit.cash_amount||0),
            applied:lossValue
          })
        });
        if(penaltyError) throw penaltyError;
      }

      if(hit.label==="흡연"){
        const {error:smokingClearError}=await db
          .from("cash_active_effects")
          .update({active:false,ended_at:new Date().toISOString()})
          .eq("effect_type","smoking")
          .eq("active",true);
        if(smokingClearError) throw smokingClearError;
      }

      if(goldenHit){
        const {data:existingKeep,error:existingKeepError}=await db
          .from("cash_keeps")
          .select("*")
          .eq("user_id",user.id)
          .eq("item_name",SPECIAL_LABEL)
          .maybeSingle();
        if(existingKeepError) throw existingKeepError;

        if(existingKeep){
          const {error:updateKeepError}=await db
            .from("cash_keeps")
            .update({
              quantity:Number(existingKeep.quantity||0)+1,
              updated_at:new Date().toISOString()
            })
            .eq("id",existingKeep.id);
          if(updateKeepError) throw updateKeepError;
        }else{
          const {error:insertKeepError}=await db
            .from("cash_keeps")
            .insert({
              user_id:user.id,
              item_name:SPECIAL_LABEL,
              quantity:1,
              time_limit_minutes:0,
              source_roulette_name:roulette.name
            });
          if(insertKeepError) throw insertKeepError;
        }

        const {error:keepTxError}=await db
          .from("cash_transactions")
          .insert({
            user_id:user.id,
            type:"keep_add",
            amount:0,
            item_name:SPECIAL_LABEL,
            note:JSON.stringify({
              source:"golden_ticket_bonus",
              roulette:roulette.name,
              spin_id:spinTx.id,
              golden_ticket_percent:goldenTicketPercent,
              base_result:hit.label
            })
          });
        if(keepTxError) throw keepTxError;
      }

      results.push({
        ok:true,
        spin_id:Number(spinTx.id),
        label:hit.label,
        result_type:hit.result_type,
        cash_delta:appliedDelta,
        balance,
        cost:effectiveCost,
        golden_ticket:goldenHit,
        golden_ticket_label:goldenHit?SPECIAL_LABEL:null
      });
    }

    const {error:userUpdateError}=await db
      .from("cash_users")
      .update({
        cash_balance:balance,
        total_spent:Number(user.total_spent||0)+spentTotal,
        updated_at:new Date().toISOString()
      })
      .eq("id",user.id);
    if(userUpdateError) throw userUpdateError;

    return out({
      ok:true,
      ...(results.length===1?results[0]:{}),
      results,
      count,
      effective_cost:effectiveCost,
      discount_percent:discountValue,
      golden_ticket_percent:goldenTicketPercent,
      total_cost:totalCost,
      balance
    });
  }catch(error){
    const message=String((error as Error)?.message||error);
    return out({error:message},message==="unauthorized"?401:500);
  }
});
