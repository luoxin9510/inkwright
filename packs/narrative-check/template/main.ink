// A scene on the pack: checks are tags on choices, voices are #voice lines, fear and trust are plain variables.
INCLUDE _engine.ink

{t("凌晨一点,走廊里有人在一扇一扇地敲门。林坐在床上,看着你。", "One in the morning. Someone in the corridor is knocking on the doors, one after another. Lin sits up in bed and looks at you.")}
{t("敲门声停在隔壁。", "The knocking stops next door.")} #voice:insight
-> door

=== door ===
* [{t("贴着门听", "Listen at the door")} #check:insight:normal]
    { check("insight", 10) >= 3:
        {t("外面没有脚步声。敲门的东西一直站在原地,只是手够得到每一扇门。", "No footsteps outside. Whatever is knocking never moves; its arm just reaches every door.")}
        ~ fear += 15
        -> choose
    - else:
        {t("什么也没听清。你的耳朵贴在门上,门那边也有什么贴了上来。", "You can't make anything out. Your ear is on the door, and something on the other side leans against it too.")}
        ~ fear += 30
        ~ fear_lin = clamp(fear_lin + 20, 0, 100)
        -> choose
    }
* [{t("拉着林躲到床底下", "Pull Lin under the bed")}]
    ~ trust_lin = clamp(trust_lin + 10, 0, 100)
    -> choose

=== choose ===
{t("敲门声又响了。这一次是你们的门。", "The knocking comes again. This time it is your door.")}
{t("别出声。", "Not a sound.")} #voice:reason
* [{t("让林别出声", "Tell Lin to keep quiet")} #check:charm:easy]
    { check("charm", 8) >= 3 || trust_lin >= 60:
        {t("林捂住了嘴。敲了三下以后,声音走远了。天亮的时候,隔壁的门开着。", "Lin covers their mouth. After three knocks it moves on. At dawn the door next door stands open.")}
    - else:
        ~ fear_lin = clamp(fear_lin + 30, 0, 100)
        {t("林叫出了声。敲门声停了。门把手开始慢慢转动。", "Lin cries out. The knocking stops. The handle starts to turn, slowly.")}
    }
* [{t("自己去开门", "Open it yourself")} #check:strength:hard]
    { check("strength", 12) >= 3:
        {t("你一把拉开门。走廊是空的,只有每扇门上都多了一个湿手印。", "You pull it open. The corridor is empty; every door has a wet handprint on it now.")}
    - else:
        ~ hp -= 4
        {t("门被另一边按住了。你和它僵持到天亮,手臂再也抬不起来。", "Something holds it from the other side. You strain against it until dawn and can no longer lift your arms.")}
    }
- {t("恐惧 {fear},林的恐惧 {fear_lin},信任 {trust_lin}。", "Fear {fear}; Lin's fear {fear_lin}, trust {trust_lin}.")}
-> END
