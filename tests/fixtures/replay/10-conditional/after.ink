VAR key = true
VAR lamp = true
In the hall.
{ lamp:
    + [Light the lamp] The hall is lit.
        -> END
}
{ key:
    + [Unlock the cellar] The cellar opens.
        -> END
}
+ [Go upstairs] You go up.
    -> END
