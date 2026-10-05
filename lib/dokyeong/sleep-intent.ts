export function sleepIntent(text:string) {
 const value=text.replace(/\s+/g,' ').trim();
 if(/(어제|그제|지난번|예전에|그때|며칠 전)/u.test(value)&&!/(지금|오늘|방금|이제|곧)/u.test(value))return false;
 if(/(안\s*(먹|자|잘)|않|아니|먹지\s*(마|말)|자지\s*(마|말))/u.test(value))return false;
 return /(자려고|자러\s*(갈|가|누울)|잘게|잘\s*거야|잘래|자야겠|자야\s*(돼|해)|잠들려고|잠\s*청하려|잘\s*준비|이제\s*눕|누워서\s*잘|졸려서\s*잘)/u.test(value)||/(수면제|스틸녹스|졸피뎀|조피스타|에스조피클론|멜라토닌).{0,18}(먹었|먹음|먹고|복용했|복용하고|삼켰)|(먹었|먹고|복용했).{0,18}(수면제|졸피뎀|멜라토닌)/u.test(value);
}
